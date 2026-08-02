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
}

/**
 * WAKitClient is the primary developer-facing interface for WAKit.
 *
 * It wraps makeWASocket with:
 * - Automatic reconnection with exponential backoff
 * - Fluent plugin registration
 * - Composable middleware pipelines for incoming/outgoing messages
 * - Typed event subscription
 *
 * All underlying WAKit socket APIs remain accessible via `.socket`.
 *
 * @example
 * ```ts
 * const client = await createClient({ auth: './session' })
 * client.on('messages.upsert', ({ messages }) => { ... })
 * await client.sendMessage(jid, { text: 'hello' })
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

	constructor(config: WAKitClientConfig, socketConfig: UserFacingSocketConfig) {
		this._socketConfig = socketConfig
		this._config = {
			autoReconnect: config.autoReconnect ?? true,
			maxReconnectAttempts: config.maxReconnectAttempts ?? Infinity,
			reconnectBaseDelayMs: config.reconnectBaseDelayMs ?? 1000
		}
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

	// ─── Connection lifecycle ────────────────────────────────────────────────

	/** @internal Called by createClient after auth state is resolved */
	async connect(): Promise<void> {
		if (this._destroyed) {
			throw new Boom('WAKitClient has been destroyed and cannot be reconnected.', { statusCode: 500 })
		}

		this._socket = makeWASocket(this._socketConfig)
		this._reattachListeners()
		this._wireAutoReconnect()
	}

	/**
	 * Gracefully disconnect and destroy the client.
	 * After this call the instance cannot be reused.
	 */
	async destroy(): Promise<void> {
		this._destroyed = true

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
	 * This handler is NOT automatically re-attached on reconnect; use on() for that.
	 */
	process(handler: (events: Partial<WAKitEventMap>) => void | Promise<void>): () => void {
		return this._socket!.ev.process(handler)
	}

	// ─── Plugin API ───────────────────────────────────────────────────────────

	/**
	 * Register and install a WAKit plugin.
	 *
	 * @example
	 * ```ts
	 * client.use(myAnalyticsPlugin)
	 * ```
	 */
	async use(plugin: WAKitPlugin): Promise<this> {
		await this._plugins.install(plugin, this)
		return this
	}

	// ─── Middleware API ───────────────────────────────────────────────────────

	/**
	 * Add middleware to the incoming message pipeline.
	 * Middleware runs in registration order for each decrypted incoming message.
	 *
	 * @example
	 * ```ts
	 * client.useIncoming(async (ctx, next) => {
	 *   console.log('received:', ctx.message.key.id)
	 *   await next()
	 * })
	 * ```
	 */
	useIncoming(middleware: Middleware<IncomingMessageContext>): this {
		this._incomingPipeline.use(middleware)
		return this
	}

	/**
	 * Add middleware to the outgoing message pipeline.
	 * Middleware runs in registration order before each message is sent.
	 *
	 * @example
	 * ```ts
	 * client.useOutgoing(async (ctx, next) => {
	 *   ctx.options.messageId ??= generateMessageIDV2(ctx.jid)
	 *   await next()
	 * })
	 * ```
	 */
	useOutgoing(middleware: Middleware<OutgoingMessageContext>): this {
		this._outgoingPipeline.use(middleware)
		return this
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

	/** Send a message. Proxied from the underlying socket, but runs through the outgoing middleware pipeline first. */
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
	}

	private _wireAutoReconnect(): void {
		if (!this._socket || !this._config.autoReconnect) return

		this._socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
			const { connection, lastDisconnect } = update
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
