import { readFile, writeFile } from 'node:fs/promises'
import { Boom } from '@hapi/boom'
import type { WAKitEventMap } from '../Types'
import type { RecordedEntry, RecordedSession, ReplayOptions, RecorderConfig } from './types'

// WAKit version is read from the package.json Defaults at runtime
const WAKIT_VERSION = '1.0.4'

/**
 * WAKitRecorder is WAKit's flagship debugging tool.
 *
 * It can record every event emitted by the WAKit event bus to memory,
 * save them to a JSON file, and replay them at any speed with filtering
 * and step-by-step control.
 *
 * @example Recording
 * ```ts
 * client.recorder.start()
 * // ... interact with WhatsApp ...
 * const session = client.recorder.stop()
 * await client.recorder.save('./debug-session.json', session)
 * ```
 *
 * @example Replay
 * ```ts
 * await client.recorder.replay('./debug-session.json', {
 *   speed: 2,
 *   filter: ['messages.upsert'],
 * })
 * ```
 *
 * @example Step-by-step debugging (async iterator — caller controls the pace)
 * ```ts
 * const stream = client.recorder.replayStream('./debug-session.json')
 * for await (const { entry, index } of stream) {
 *   console.log(`[${index}]`, entry.event, entry.data)
 *   // returning from the loop body automatically advances to the next event
 * }
 * ```
 */
export class WAKitRecorder {
	private _recording: RecordedEntry[] | null = null
	private _listeners: Array<() => void> = []
	private readonly _config: RecorderConfig
	private _emitFn: ((event: keyof WAKitEventMap, data: WAKitEventMap[keyof WAKitEventMap]) => void) | null = null
	private _onFn:
		((event: keyof WAKitEventMap, listener: (data: WAKitEventMap[keyof WAKitEventMap]) => void) => void) | null = null
	private _offFn:
		((event: keyof WAKitEventMap, listener: (data: WAKitEventMap[keyof WAKitEventMap]) => void) => void) | null = null

	constructor(config: RecorderConfig = {}) {
		this._config = config
	}

	/**
	 * @internal Called by WAKitClient to wire up event listening and emission.
	 */
	_wire(
		onFn: (event: keyof WAKitEventMap, listener: (data: WAKitEventMap[keyof WAKitEventMap]) => void) => void,
		offFn: (event: keyof WAKitEventMap, listener: (data: WAKitEventMap[keyof WAKitEventMap]) => void) => void,
		emitFn: (event: keyof WAKitEventMap, data: WAKitEventMap[keyof WAKitEventMap]) => void
	): void {
		this._onFn = onFn
		this._offFn = offFn
		this._emitFn = emitFn
	}

	/** Whether the recorder is currently capturing events */
	get isRecording(): boolean {
		return this._recording !== null
	}

	/** Number of events captured in the current recording session */
	get eventCount(): number {
		return this._recording?.length ?? 0
	}

	/**
	 * Start recording all WAKit events.
	 * Calling start() while already recording is a no-op.
	 */
	start(): void {
		if (this._recording !== null) return
		this._recording = []

		if (!this._onFn) return

		const eventsToRecord = this._config.events ?? ALL_EVENTS

		for (const event of eventsToRecord) {
			const listener = (data: WAKitEventMap[keyof WAKitEventMap]) => {
				this._recording?.push({
					event,
					data,
					timestamp: new Date().toISOString()
				})
			}

			this._onFn(event, listener)
			this._listeners.push(() => this._offFn?.(event, listener))
		}
	}

	/**
	 * Stop recording and return the captured session.
	 * Throws if not currently recording.
	 */
	stop(): RecordedSession {
		if (this._recording === null) {
			throw new Boom('Recorder is not currently recording. Call start() first.', { statusCode: 400 })
		}

		const events = [...this._recording]
		this._recording = null

		// Clean up all listeners
		for (const cleanup of this._listeners) cleanup()
		this._listeners = []

		return {
			version: 1,
			WAKitVersion: WAKIT_VERSION,
			recordedAt: new Date().toISOString(),
			events
		}
	}

	/**
	 * Save a recorded session to a JSON file.
	 * If no session is provided, saves the current in-progress recording snapshot.
	 */
	async save(path: string, session?: RecordedSession): Promise<void> {
		const target = session ?? {
			version: 1 as const,
			WAKitVersion: WAKIT_VERSION,
			recordedAt: new Date().toISOString(),
			events: this._recording ?? []
		}

		const data = JSON.stringify(target, null, 2)
		await writeFile(path, data, 'utf-8')
	}

	/**
	 * Load a recorded session from a JSON file.
	 */
	async load(path: string): Promise<RecordedSession> {
		let raw: string
		try {
			raw = await readFile(path, 'utf-8')
		} catch {
			throw new Boom(`Replay file not found: "${path}".`, { statusCode: 404 })
		}

		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			throw new Boom(`Replay file corrupted: "${path}" is not valid JSON.`, { statusCode: 422 })
		}

		const session = parsed as RecordedSession
		if (session.version !== 1 || !Array.isArray(session.events)) {
			throw new Boom(`Replay file "${path}" has an unsupported format. Expected version 1.`, {
				statusCode: 422
			})
		}

		return session
	}

	/**
	 * Replay events from a file path or a pre-loaded session.
	 * Events are emitted via the client's event system as if they were live.
	 *
	 * @example Real-time replay
	 * ```ts
	 * await client.recorder.replay('./session.json')
	 * ```
	 *
	 * @example 5x speed, only messages
	 * ```ts
	 * await client.recorder.replay('./session.json', {
	 *   speed: 5,
	 *   filter: ['messages.upsert']
	 * })
	 * ```
	 */
	async replay(source: string | RecordedSession, opts: ReplayOptions = {}): Promise<void> {
		if (!this._emitFn) {
			throw new Boom('Recorder is not wired to a client. Use client.recorder instead.', {
				statusCode: 503
			})
		}

		const session = typeof source === 'string' ? await this.load(source) : source
		const { speed = 1, filter, fromIndex = 0, toIndex, onEvent } = opts

		const events = session.events.slice(fromIndex, toIndex !== undefined ? toIndex + 1 : undefined)

		const filtered = filter ? events.filter(e => filter.includes(e.event)) : events

		if (filtered.length === 0) return

		if (opts.stepByStep) {
			for (const [i, entry] of filtered.entries()) {
				onEvent?.(entry, fromIndex + i)
				// In step-by-step mode we emit synchronously and yield to the caller
				// The step iteration is controlled by the for-of loop itself
				this._emitFn(entry.event, entry.data)
				// Small yield to allow event listeners to process
				await new Promise(r => setTimeout(r, 0))
			}

			return
		}

		// Time-based replay
		const firstTs = new Date(filtered[0]!.timestamp).getTime()

		for (const [i, entry] of filtered.entries()) {
			const entryTs = new Date(entry.timestamp).getTime()
			const delay = speed > 0 ? (entryTs - firstTs) / speed : 0

			if (delay > 0) {
				await new Promise(r => setTimeout(r, delay))
			}

			onEvent?.(entry, fromIndex + i)
			this._emitFn(entry.event, entry.data)
		}
	}

	/**
	 * Replay events from a file or session as an async generator.
	 * Each iteration yields the next event and emits it into the WAKit event system,
	 * giving the caller full control over pacing via the `for await` loop.
	 *
	 * Unlike `replay()`, this method does not apply time-based delays — events are
	 * emitted one per iteration. Use this for step-by-step debugging or when you
	 * need to inspect each event before it reaches your handlers.
	 *
	 * @param source File path or pre-loaded session
	 * @param opts Subset of ReplayOptions: `filter`, `fromIndex`, `toIndex`
	 *
	 * @example
	 * ```ts
	 * for await (const { entry, index } of client.recorder.replayStream('./session.json')) {
	 *   console.log(`[${index}]`, entry.event)
	 *   // Only messages.upsert events reach your handlers — filtered inline:
	 * }
	 *
	 * // With filter
	 * const stream = client.recorder.replayStream('./session.json', {
	 *   filter: ['messages.upsert', 'connection.update']
	 * })
	 * for await (const { entry, index } of stream) {
	 *   console.log(`Event ${index}:`, entry.event)
	 * }
	 * ```
	 */
	async *replayStream(
		source: string | RecordedSession,
		opts: Pick<ReplayOptions, 'filter' | 'fromIndex' | 'toIndex'> = {}
	): AsyncGenerator<{ entry: RecordedEntry; index: number }> {
		if (!this._emitFn) {
			throw new Boom('Recorder is not wired to a client. Use client.recorder instead.', {
				statusCode: 503
			})
		}

		const session = typeof source === 'string' ? await this.load(source) : source
		const { filter, fromIndex = 0, toIndex } = opts

		const events = session.events.slice(fromIndex, toIndex !== undefined ? toIndex + 1 : undefined)
		const filtered = filter ? events.filter(e => filter.includes(e.event)) : events

		for (const [i, entry] of filtered.entries()) {
			const absoluteIndex = fromIndex + i
			// Emit into the live event system so all registered handlers fire
			this._emitFn(entry.event, entry.data)
			// Yield control to the caller — they decide when to advance
			yield { entry, index: absoluteIndex }
			// Micro-yield so event listeners can process before the next iteration
			await new Promise(r => setTimeout(r, 0))
		}
	}
}

// All known WAKit event types for default recording
const ALL_EVENTS: Array<keyof WAKitEventMap> = [
	'connection.update',
	'creds.update',
	'messaging-history.set',
	'messaging-history.status',
	'chats.upsert',
	'chats.update',
	'chats.delete',
	'presence.update',
	'contacts.upsert',
	'contacts.update',
	'messages.delete',
	'messages.update',
	'messages.media-update',
	'messages.upsert',
	'messages.reaction',
	'message-receipt.update',
	'groups.upsert',
	'groups.update',
	'group-participants.update',
	'group.join-request',
	'blocklist.set',
	'blocklist.update',
	'call',
	'labels.edit',
	'labels.association'
]
