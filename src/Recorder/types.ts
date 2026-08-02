import type { WAKitEventMap } from '../Types'

// ─── Recorded Event ───────────────────────────────────────────────────────────

/** A single recorded WAKit event with its timestamp */
export interface RecordedEntry<E extends keyof WAKitEventMap = keyof WAKitEventMap> {
	event: E
	data: WAKitEventMap[E]
	/** ISO-8601 timestamp of when the event was emitted */
	timestamp: string
}

// ─── Session ──────────────────────────────────────────────────────────────────

/** A complete recorded session */
export interface RecordedSession {
	/** File format version */
	version: 1
	/** WAKit library version at time of recording */
	WAKitVersion: string
	/** ISO-8601 timestamp of when recording started */
	recordedAt: string
	/** All captured events in chronological order */
	events: RecordedEntry[]
}

// ─── Replay Options ───────────────────────────────────────────────────────────

/**
 * Options for controlling event replay behavior.
 *
 * @example
 * ```ts
 * await client.recorder.replay('./session.json', {
 *   speed: 2,               // 2x speed
 *   filter: ['messages.upsert', 'call'],
 *   fromIndex: 10,          // skip first 10 events
 *   onEvent: (entry, i) => console.log(`[${i}]`, entry.event)
 * })
 * ```
 */
export interface ReplayOptions {
	/**
	 * Playback speed multiplier relative to recorded timestamps.
	 * - 1 = real-time (default)
	 * - 2 = 2x speed
	 * - 5 = 5x speed
	 * - 0 = instant (no delays)
	 */
	speed?: number
	/**
	 * If true, replay pauses before each event. Call the returned `step()`
	 * function to advance to the next event.
	 * When using step-by-step mode, `speed` is ignored.
	 */
	stepByStep?: boolean
	/**
	 * Only replay events of these types. If omitted, all event types are replayed.
	 */
	filter?: Array<keyof WAKitEventMap>
	/** Start replay from this event index (0-based, inclusive). Default: 0 */
	fromIndex?: number
	/** Stop replay at this event index (0-based, inclusive). Default: last event */
	toIndex?: number
	/**
	 * Callback invoked for each event just before it is emitted.
	 * Useful for progress reporting or per-event inspection.
	 */
	onEvent?: (entry: RecordedEntry, index: number) => void
}

/** Configuration for WAKitRecorder */
export interface RecorderConfig {
	/**
	 * Events to record. If omitted, all WAKit events are recorded.
	 *
	 * Note: for most debugging purposes, the default (all events) is best.
	 */
	events?: Array<keyof WAKitEventMap>
}
