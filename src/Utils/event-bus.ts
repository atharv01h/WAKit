import type { WAKitEvent, WAKitEventEmitter, WAKitEventMap } from '../Types'

// ─── Ring Buffer ──────────────────────────────────────────────────────────────

/** A fixed-capacity ring buffer for O(1) append and O(N) iteration */
class RingBuffer<T> {
	private readonly _buf: Array<T | undefined>
	private _head = 0
	private _size = 0

	constructor(private readonly capacity: number) {
		this._buf = new Array<T | undefined>(capacity).fill(undefined)
	}

	push(item: T): void {
		this._buf[this._head] = item
		this._head = (this._head + 1) % this.capacity
		if (this._size < this.capacity) this._size++
	}

	/** Returns all items in insertion order (oldest first) */
	toArray(): T[] {
		if (this._size === 0) return []
		if (this._size < this.capacity) {
			return this._buf.slice(0, this._size) as T[]
		}

		// Full buffer — start from head (oldest)
		const result: T[] = new Array(this.capacity)
		for (let i = 0; i < this.capacity; i++) {
			result[i] = this._buf[(this._head + i) % this.capacity] as T
		}

		return result
	}

	clear(): void {
		this._buf.fill(undefined)
		this._head = 0
		this._size = 0
	}
}

// ─── Event History Entry ──────────────────────────────────────────────────────

export interface EventHistoryEntry<E extends keyof WAKitEventMap = keyof WAKitEventMap> {
	event: E
	data: WAKitEventMap[E]
	timestamp: Date
}

// ─── Enhanced Event Bus Options ───────────────────────────────────────────────

export interface WAKitEventBusOptions {
	/**
	 * Maximum events to keep per event type in the replay ring buffer.
	 * Default: 100 per event type.
	 */
	historyCapacity?: number
	/**
	 * Enable event recording (capture all events to an in-memory list).
	 * Default: false (enabled on demand via record()).
	 */
	enableRecording?: boolean
}

// ─── WAKitEventBus ────────────────────────────────────────────────────────────

/**
 * WAKitEventBus enhances the WAKitEventEmitter with:
 * - Per-event-type ring-buffer history for replay
 * - Filtered subscriptions (subscribe with a predicate)
 * - Event recording and playback for debugging
 * - Time-travel: replay events since a given timestamp
 *
 * All standard WAKitEventEmitter methods (on/off/emit/etc.) are preserved.
 */
export interface WAKitEventBus extends WAKitEventEmitter {
	/**
	 * Subscribe to an event, but only when the predicate returns true.
	 * Returns an unsubscribe function.
	 *
	 * @example
	 * ```ts
	 * const unsub = bus.filter('messages.upsert',
	 *   ({ messages }) => messages.some(m => m.key.fromMe),
	 *   ({ messages }) => console.log('my message:', messages)
	 * )
	 * ```
	 */
	filter<E extends keyof WAKitEventMap>(
		event: E,
		predicate: (data: WAKitEventMap[E]) => boolean,
		listener: (data: WAKitEventMap[E]) => void
	): () => void

	/**
	 * Replay all buffered history for the given event.
	 * Calls listener synchronously for each stored entry (oldest first).
	 *
	 * @param since optional cutoff — only replay events after this Date
	 *
	 * @example
	 * ```ts
	 * bus.replay('messages.upsert', ({ messages }) => console.log(messages))
	 * ```
	 */
	replay<E extends keyof WAKitEventMap>(
		event: E,
		listener: (data: WAKitEventMap[E]) => void,
		since?: Date
	): void

	/**
	 * Start capturing all events to an in-memory recording.
	 * Returns a stop function that returns the captured events.
	 *
	 * @example
	 * ```ts
	 * const stop = bus.record()
	 * // ... do things ...
	 * const captured = stop()
	 * console.log(captured) // [{event, data, timestamp}, ...]
	 * ```
	 */
	record(): () => EventHistoryEntry[]

	/**
	 * Returns the ring-buffer history for a given event type.
	 * Useful for diagnostics.
	 */
	history<E extends keyof WAKitEventMap>(event: E): EventHistoryEntry<E>[]
}

/**
 * Wraps an existing WAKitEventEmitter with the WAKitEventBus enhancements.
 * Does NOT alter the original emitter — it proxies all calls through.
 *
 * @example
 * ```ts
 * const bus = wrapEventBus(sock.ev, { historyCapacity: 50 })
 * bus.replay('messages.upsert', handler)
 * ```
 */
export function wrapEventBus(
	baseEmitter: WAKitEventEmitter,
	opts: WAKitEventBusOptions = {}
): WAKitEventBus {
	const historyCapacity = opts.historyCapacity ?? 100

	// Per-event ring buffers (lazily created)
	const rings = new Map<keyof WAKitEventMap, RingBuffer<EventHistoryEntry>>()

	// Recording state
	let recording: EventHistoryEntry[] | null = null

	function getRing<E extends keyof WAKitEventMap>(event: E): RingBuffer<EventHistoryEntry<E>> {
		if (!rings.has(event)) {
			rings.set(event, new RingBuffer<EventHistoryEntry>(historyCapacity))
		}

		return rings.get(event) as RingBuffer<EventHistoryEntry<E>>
	}

	// Intercept emit to record history
	const originalEmit = baseEmitter.emit.bind(baseEmitter)

	const enhancedEmit = <E extends keyof WAKitEventMap>(
		event: E,
		data: WAKitEventMap[E]
	): boolean => {
		// Record to ring buffer
		const entry: EventHistoryEntry<E> = { event, data, timestamp: new Date() }
		getRing(event).push(entry as unknown as EventHistoryEntry<E>)

		// Record to active recording if any
		if (recording) {
			recording.push(entry as unknown as EventHistoryEntry)
		}

		return originalEmit(event, data)
	}

	const bus: WAKitEventBus = {
		// Proxy standard methods
		on: baseEmitter.on.bind(baseEmitter),
		off: baseEmitter.off.bind(baseEmitter),
		removeAllListeners: baseEmitter.removeAllListeners.bind(baseEmitter),
		emit: enhancedEmit,

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

			baseEmitter.on(event, wrapped)
			return () => baseEmitter.off(event, wrapped)
		},

		replay<E extends keyof WAKitEventMap>(
			event: E,
			listener: (data: WAKitEventMap[E]) => void,
			since?: Date
		): void {
			const ring = getRing(event)
			const entries = ring.toArray()
			for (const entry of entries) {
				if (!since || entry.timestamp > since) {
					listener(entry.data as WAKitEventMap[E])
				}
			}
		},

		record(): () => EventHistoryEntry[] {
			recording = []
			const captured = recording
			return () => {
				recording = null
				return captured
			}
		},

		history<E extends keyof WAKitEventMap>(event: E): EventHistoryEntry<E>[] {
			return getRing(event).toArray() as EventHistoryEntry<E>[]
		}
	}

	return bus
}
