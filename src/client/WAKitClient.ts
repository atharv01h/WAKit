import { Boom } from '@hapi/boom'
import type { WAKitEventMap, UserFacingSocketConfig, ConnectionState } from '../Types'
import { DisconnectReason } from '../Types'
import type { ILogger } from '../Utils/logger'
import type { WAKitPlugin } from '../Plugins/types'
import type { Middleware } from '../Middleware/types'
import { PluginRegistry } from '../Plugins/PluginRegistry'
import { createPipeline } from '../Middleware/createPipeline'
import type { IncomingMessageContext, OutgoingMessageContext } from '../Middleware/types'
import makeWASocket from '../Socket/index'
import type { WAKitStore } from '../Storage/types'
import { WAKitRestServer } from '../REST/WAKitRestServer'
import type { RestApiConfig } from '../REST/types'
import { WAKitScheduler } from '../Scheduler/WAKitScheduler'
import type { SchedulerConfig } from '../Scheduler/types'
import { WAKitRecorder } from '../Recorder/WAKitRecorder'
import type { RecorderConfig } from '../Recorder/types'
import { RingBuffer, type EventHistoryEntry, type WAKitEventBusOptions } from '../Utils/event-bus'

type WASocket = ReturnType<typeof makeWASocket>

export interface WAKitClientConfig extends Omit<Partial<UserFacingSocketConfig>, 'auth'> {
	/** Directory path or custom AuthenticationState for session storage */
	auth: UserFacingSocketConfig['auth'] | string | WAKitStore
	/** Logger instance. Defaults to a silent pino logger */
	logger?: ILogger
	/** Automatically reconnect on disconnect (default: true) */
	autoReconnect?: boolean
	/** Max reconnect attempts before giving up (default: Infinity) */
	maxReconnectAttempts?: number
	/** Base delay in ms between reconnect attempts, uses exponential backoff (default: 1000) */
	reconnectBaseDelayMs?: number
	/** REST API configuration. Pass to auto-initialize client.api */
	rest?: RestApiConfig
	/** Scheduler configuration */
	scheduler?: SchedulerConfig
	/** Recorder configuration */
	recorder?: RecorderConfig
	/** Event Bus configuration (e.g., history capacity) */
	eventBus?: WAKitEventBusOptions
}

/**
 * WAKitClient is the primary developer-facing interface for WAKit.
 *
 * It wraps makeWASocket with:
 * - Automatic reconnection with exponential backoff
 * - Fluent plugin registration (with full lifecycle: initialize → install → ready)
 * - Composable middleware pipelines for incoming/outgoing messages
 * - Typed event subscription (survives reconnects)
 * - REST API server (client.api)
 * - Job scheduler (client.scheduler)
 * - Event recorder & replay (client.recorder)
 *
 * All underlying WAKit socket APIs remain accessible via `.socket`.
 *
 * @example
 * ```ts
 * const client = await createClient({ auth: './session' })
 * client.on('messages.upsert', ({ messages }) => { ... })
 * await client.sendMessage(jid, { text: 'hello' })
 *
 * // REST API
 * await client.api.start()
 *
 * // Scheduler
 * client.scheduler.daily('09:00', async () => {
 *   await client.sendMessage(jid, { text: 'Good morning!' })
 * })
 *
 * // Recorder
 * client.recorder.start()
 * ```
 */
export class WAKitClient {
	private _socket: WASocket | null = null
	private readonly _plugins = new PluginRegistry()
	private readonly _incomingPipeline = createPipeline<IncomingMessageContext>()
	private readonly _outgoingPipeline = createPipeline<OutgoingMessageContext>()
	private _reconnectAttempts = 0
	private _destroyed = false

	/** Resolved socket config, set once in connect() */
	private _socketConfig!: UserFacingSocketConfig

	private readonly _config: Required<
		Pick<WAKitClientConfig, 'autoReconnect' | 'maxReconnectAttempts' | 'reconnectBaseDelayMs'>
	>

	// Pending event listeners that should be re-registered on reconnect
	private readonly _eventListeners = new Map<
		keyof WAKitEventMap,
		Array<(arg: WAKitEventMap[keyof WAKitEventMap]) => void>
	>()

	// Pending process handlers that should be re-registered on reconnect
	private readonly _processHandlers: Array<(events: Partial<WAKitEventMap>) => void | Promise<void>> = []

	// ─── Event Bus State ─────────────────────────────────────────────────────
	private readonly _eventRings = new Map<keyof WAKitEventMap, RingBuffer<EventHistoryEntry>>()
	private _eventRecording: EventHistoryEntry[] | null = null
	private readonly _eventBusConfig: WAKitEventBusOptions

	// ─── Sub-systems ─────────────────────────────────────────────────────────

	/** The REST API server subsystem. Call .start() to begin listening. */
	readonly api: WAKitRestServer

	/** The job scheduler subsystem. Jobs registered here survive reconnects. */
	readonly scheduler: WAKitScheduler

	/** The event recorder and replay subsystem. */
	readonly recorder: WAKitRecorder

	constructor(config: WAKitClientConfig, socketConfig: UserFacingSocketConfig) {
		this._socketConfig = socketConfig
		this._config = {
			autoReconnect: config.autoReconnect ?? true,
			maxReconnectAttempts: config.maxReconnectAttempts ?? Infinity,
			reconnectBaseDelayMs: config.reconnectBaseDelayMs ?? 1000
		}

		// Initialize sub-systems
		this.api = new WAKitRestServer(this, config.rest ?? {})
		this.scheduler = new WAKitScheduler(config.scheduler ?? {})
		this.recorder = new WAKitRecorder(config.recorder ?? {})
		this._eventBusConfig = config.eventBus ?? {}
	}

	/**
	 * The raw underlying WAKit socket.
	 * Available after connect() resolves.
	 * Use for advanced operations not yet wrapped by WAKitClient.
	 */
	get socket(): WASocket {
		if (!this._socket) {
			throw new Boom('WAKitClient is not connected. Call connect() first.', { statusCode: 503 })
		}

		return this._socket
	}

	/** The authenticated user's JID, if connected and registered */
	get user() {
		return this._socket?.user ?? null
	}

	/** The current auth state credentials */
	get authState() {
		return this._socket?.authState ?? null
	}

	/** Read-only diagnostics for all installed plugins */
	get plugins() {
		return this._plugins.diagnostics()
	}

	// ─── Connection lifecycle ────────────────────────────────────────────────

	/** @internal Called by createClient after auth state is resolved */
	async connect(): Promise<void> {
		if (this._destroyed) {
			throw new Boom('WAKitClient has been destroyed and cannot be reconnected.', { statusCode: 500 })
		}

		this._socket = makeWASocket(this._socketConfig)

		// Intercept emit on the socket to record history
		const originalEmit = this._socket.ev.emit.bind(this._socket.ev)
		this._socket.ev.emit = <E extends keyof WAKitEventMap>(event: E, data: WAKitEventMap[E]): boolean => {
			const entry: EventHistoryEntry<E> = { event, data, timestamp: new Date() }
			this._getRing(event).push(entry)
			if (this._eventRecording) {
				this._eventRecording.push(entry)
			}
			return originalEmit(event, data)
		}

		this._reattachListeners()
		this._wireAutoReconnect()

		// Start the scheduler and wire sendMessage
		this.scheduler._setSendMessage((jid, content) => this.sendMessage(jid, content))
		this.scheduler.start()

		// Wire the recorder to this socket's event system
		this.recorder._wire(
			(event, listener) => this._socket?.ev.on(event, listener),
			(event, listener) => this._socket?.ev.off(event, listener),
			(event, data) => this._socket?.ev.emit(event, data)
		)
	}

	/**
	 * Gracefully disconnect and destroy the client.
	 * After this call the instance cannot be reused.
	 */
	async destroy(): Promise<void> {
		this._destroyed = true

		// Stop sub-systems
		this.scheduler.stop()
		if (this.api.isRunning) {
			await this.api.stop()
		}

		// Uninstall all plugins in reverse order
		const pluginNames = this._plugins.installedNames().reverse()
		for (const name of pluginNames) {
			try {
				await this._plugins.uninstall(name, this)
			} catch {
				// best-effort cleanup
			}
		}

		if (this._socket) {
			try {
				await this._socket.logout()
			} catch {
				// socket may already be closed
			}

			this._socket = null
		}
	}

	// ─── Event API (typed, survives reconnects) ───────────────────────────────

	/**
	 * Subscribe to a typed WAKit event.
	 * Listeners registered here are automatically re-attached on reconnect.
	 */
	on<E extends keyof WAKitEventMap>(event: E, listener: (arg: WAKitEventMap[E]) => void): this {
		// Track for reconnect re-attachment
		if (!this._eventListeners.has(event)) {
			this._eventListeners.set(event, [])
		}

		this._eventListeners.get(event)!.push(listener as (arg: WAKitEventMap[keyof WAKitEventMap]) => void)

		// Attach immediately if socket already exists
		this._socket?.ev.on(event, listener)
		return this
	}

	/**
	 * Unsubscribe a previously registered event listener.
	 */
	off<E extends keyof WAKitEventMap>(event: E, listener: (arg: WAKitEventMap[E]) => void): this {
		const listeners = this._eventListeners.get(event)
		if (listeners) {
			const idx = listeners.indexOf(listener as (arg: WAKitEventMap[keyof WAKitEventMap]) => void)
			if (idx !== -1) {
				listeners.splice(idx, 1)
			}
		}

		this._socket?.ev.off(event, listener)
		return this
	}

	/**
	 * Process all events in a single batch handler (same as sock.ev.process).
	 * Handlers registered here are automatically re-attached on reconnect.
	 */
	process(handler: (events: Partial<WAKitEventMap>) => void | Promise<void>): () => void {
		this._processHandlers.push(handler)

		let socketUnsub: (() => void) | undefined
		if (this._socket) {
			socketUnsub = this._socket.ev.process(handler)
		}

		return () => {
			const idx = this._processHandlers.indexOf(handler)
			if (idx !== -1) {
				this._processHandlers.splice(idx, 1)
			}
			if (socketUnsub) socketUnsub()
		}
	}

	/**
	 * Subscribe to an event, but only when the predicate returns true.
	 * Returns an unsubscribe function.
	 */
	filter<E extends keyof WAKitEventMap>(
		event: E,
		predicate: (data: WAKitEventMap[E]) => boolean,
		listener: (data: WAKitEventMap[E]) => void
	): () => void {
		const wrapped = (data: WAKitEventMap[E]) => {
			if (predicate(data)) {
				listener(data)
			}
		}

		this.on(event, wrapped)
		return () => this.off(event, wrapped)
	}

	/**
	 * Replay all buffered history for the given event.
	 * Calls listener synchronously for each stored entry (oldest first).
	 */
	replay<E extends keyof WAKitEventMap>(event: E, listener: (data: WAKitEventMap[E]) => void, since?: Date): void {
		const ring = this._getRing(event)
		const entries = ring.toArray()
		for (const entry of entries) {
			if (!since || entry.timestamp > since) {
				listener(entry.data)
			}
		}
	}

	/**
	 * Start capturing all events to an in-memory recording.
	 * Returns a stop function that returns the captured events.
	 */
	record(): () => EventHistoryEntry[] {
		this._eventRecording = []
		const captured = this._eventRecording
		return () => {
			this._eventRecording = null
			return captured
		}
	}

	/**
	 * Returns the ring-buffer history for a given event type.
	 */
	history<E extends keyof WAKitEventMap>(event: E): EventHistoryEntry<E>[] {
		return this._getRing(event).toArray()
	}

	// ─── Plugin API ───────────────────────────────────────────────────────────

	/**
	 * Register and install a WAKit plugin.
	 * Calls the full lifecycle: initialize → install.
	 * Call `client.pluginsReady()` after all plugins are registered to trigger `ready()`.
	 *
	 * @example
	 * ```ts
	 * await client.use(myAnalyticsPlugin)
	 * await client.use(WebhookPlugin({ url: 'https://...' }))
	 * await client.pluginsReady()
	 * ```
	 */
	async use(plugin: WAKitPlugin): Promise<this> {
		await this._plugins.install(plugin, this)
		return this
	}

	/**
	 * Signal that all plugins have been installed.
	 * This triggers the `ready()` lifecycle hook on each plugin.
	 * Call once after all `client.use()` calls.
	 */
	async pluginsReady(): Promise<void> {
		await this._plugins.callReady(this)
	}

	/**
	 * Reload a plugin by name (uninstall + reinstall).
	 * @param name The plugin name to reload.
	 * @param newPlugin Optional replacement plugin definition.
	 */
	async reloadPlugin(name: string, newPlugin?: WAKitPlugin): Promise<void> {
		await this._plugins.reload(name, this, newPlugin)
	}

	// ─── Middleware API ───────────────────────────────────────────────────────

	/**
	 * Add middleware to the incoming message pipeline.
	 * Middleware runs in registration order for each decrypted incoming message.
	 *
	 * @param middleware The middleware function.
	 * @param id Optional identifier for later removal/toggling.
	 * @returns The assigned middleware ID.
	 *
	 * @example
	 * ```ts
	 * client.useIncoming(async (ctx, next) => {
	 *   console.log('received:', ctx.message.key.id)
	 *   await next()
	 * }, 'my-logger')
	 * ```
	 */
	useIncoming(middleware: Middleware<IncomingMessageContext>, id?: string): string {
		return this._incomingPipeline.use(middleware, id)
	}

	/**
	 * Add middleware to the outgoing message pipeline.
	 * Middleware runs in registration order before each message is sent.
	 *
	 * @param middleware The middleware function.
	 * @param id Optional identifier for later removal/toggling.
	 * @returns The assigned middleware ID.
	 *
	 * @example
	 * ```ts
	 * client.useOutgoing(async (ctx, next) => {
	 *   ctx.options.messageId ??= generateMessageIDV2(ctx.jid)
	 *   await next()
	 * })
	 * ```
	 */
	useOutgoing(middleware: Middleware<OutgoingMessageContext>, id?: string): string {
		return this._outgoingPipeline.use(middleware, id)
	}

	/**
	 * Remove a middleware from the incoming pipeline by ID.
	 * @returns true if the middleware was found and removed.
	 */
	removeIncoming(id: string): boolean {
		return this._incomingPipeline.remove(id)
	}

	/**
	 * Remove a middleware from the outgoing pipeline by ID.
	 * @returns true if the middleware was found and removed.
	 */
	removeOutgoing(id: string): boolean {
		return this._outgoingPipeline.remove(id)
	}

	/** @internal Exposes the incoming pipeline to the socket layer */
	get incomingPipeline() {
		return this._incomingPipeline
	}

	/** @internal Exposes the outgoing pipeline to the socket layer */
	get outgoingPipeline() {
		return this._outgoingPipeline
	}

	// ─── Proxied socket methods (ergonomic shortcuts) ─────────────────────────

	/** Send a message. Runs through the outgoing middleware pipeline first. */
	async sendMessage(
		jid: string,
		content: import('../Types').AnyMessageContent,
		options?: import('../Types').MiscMessageGenerationOptions
	) {
		const ctx: OutgoingMessageContext = { jid, content, options, abort: false, meta: {} }

		if (this._outgoingPipeline.hasMiddleware) {
			await this._outgoingPipeline.execute(ctx)
			if (ctx.abort) return undefined
		}

		return this.socket.sendMessage(ctx.jid, ctx.content, ctx.options)
	}

	/** Fetch a group's metadata. Proxied from the underlying socket. */
	get groupMetadata() {
		return this.socket.groupMetadata.bind(this.socket)
	}

	/** Check if numbers are on WhatsApp. Proxied from the underlying socket. */
	get onWhatsApp() {
		return this.socket.onWhatsApp.bind(this.socket)
	}

	/** Request a pairing code for phone-number based auth. */
	get requestPairingCode() {
		return this.socket.requestPairingCode.bind(this.socket)
	}

	/** Update presence (typing, recording, etc.). */
	get sendPresenceUpdate() {
		return this.socket.sendPresenceUpdate.bind(this.socket)
	}

	/** Log out and invalidate the session. */
	get logout() {
		return this.socket.logout.bind(this.socket)
	}

	// ─── Internal helpers ─────────────────────────────────────────────────────

	private _getRing<E extends keyof WAKitEventMap>(event: E): RingBuffer<EventHistoryEntry<E>> {
		if (!this._eventRings.has(event)) {
			this._eventRings.set(event, new RingBuffer<EventHistoryEntry>(this._eventBusConfig.historyCapacity ?? 100))
		}

		return this._eventRings.get(event) as RingBuffer<EventHistoryEntry<E>>
	}

	private _reattachListeners(): void {
		if (!this._socket) return
		for (const [event, listeners] of this._eventListeners) {
			if (event === 'messages.upsert') {
				// Special handling for messages.upsert to run the incoming pipeline
				this._socket.ev.on('messages.upsert', async data => {
					if (!this._incomingPipeline.hasMiddleware) {
						listeners.forEach(l => l(data))
						return
					}

					const upsert = data
					const processedMessages = []

					for (const msg of upsert.messages) {
						const ctx: IncomingMessageContext = {
							message: msg,
							remoteJid: msg.key.remoteJid!,
							drop: false,
							meta: {}
						}

						await this._incomingPipeline.execute(ctx)
						if (!ctx.drop) {
							processedMessages.push(ctx.message)
						}
					}

					if (processedMessages.length > 0) {
						const newData = { ...upsert, messages: processedMessages }
						listeners.forEach(l => l(newData))
					}
				})
			} else {
				for (const listener of listeners) {
					this._socket.ev.on(event, listener)
				}
			}
		}

		for (const handler of this._processHandlers) {
			this._socket.ev.process(handler)
		}
	}

	private _wireAutoReconnect(): void {
		if (!this._socket || !this._config.autoReconnect) return

		this._socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
			const { connection, lastDisconnect } = update

			if (connection === 'open') {
				this._reconnectAttempts = 0
				return
			}

			if (connection !== 'close' || this._destroyed) return

			const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
			const shouldReconnect =
				statusCode !== DisconnectReason.loggedOut &&
				statusCode !== DisconnectReason.forbidden &&
				this._reconnectAttempts < this._config.maxReconnectAttempts

			if (!shouldReconnect) {
				return
			}

			this._reconnectAttempts++
			const delay = Math.min(
				this._config.reconnectBaseDelayMs * Math.pow(2, this._reconnectAttempts - 1),
				60_000 // cap at 60 seconds
			)

			await new Promise(r => setTimeout(r, delay))

			if (!this._destroyed) {
				await this.connect()
			}
		})
	}
}
