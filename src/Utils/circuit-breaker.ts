import EventEmitter from 'events'
import { Boom } from '@hapi/boom'

/** Circuit breaker state machine states */
export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
	/**
	 * Number of consecutive failures before the circuit opens.
	 * Default: 5
	 */
	failureThreshold?: number
	/**
	 * Number of consecutive successes in half-open state before circuit closes.
	 * Default: 2
	 */
	successThreshold?: number
	/**
	 * Time in ms before moving from open → half-open.
	 * Default: 30_000 (30 seconds)
	 */
	resetTimeoutMs?: number
	/** Human-readable name for this circuit (used in logs and events) */
	name?: string
}

export interface CircuitBreakerEvents {
	/** Emitted when the circuit transitions to open (calls are now failing fast) */
	open: [{ failures: number }]
	/** Emitted when the circuit transitions back to closed (calls are now allowed) */
	close: [{ successes: number }]
	/** Emitted when the circuit transitions to half-open (test calls allowed) */
	'half-open': []
	/** Emitted on each call rejection while open */
	rejected: [{ name: string }]
}

/**
 * A three-state circuit breaker (Closed → Open → Half-Open → Closed).
 *
 * When too many consecutive failures occur, the circuit "opens" and
 * immediately rejects all calls with a 503. After a reset timeout,
 * a single test call is allowed ("half-open"). If it succeeds the
 * circuit closes; if it fails it reopens.
 *
 * @example
 * ```ts
 * const cb = new CircuitBreaker({ name: 'media-upload', failureThreshold: 3 })
 *
 * try {
 *   const result = await cb.exec(() => uploadMedia(file))
 * } catch (err) {
 *   if (err instanceof Boom && err.output.statusCode === 503) {
 *     console.log('Circuit open — media upload service unavailable')
 *   }
 * }
 *
 * cb.on('open', () => logger.warn('circuit opened'))
 * cb.on('close', () => logger.info('circuit closed'))
 * ```
 */
export class CircuitBreaker extends EventEmitter {
	private _state: CircuitState = 'closed'
	private _failures = 0
	private _successes = 0
	private _resetTimer: NodeJS.Timeout | null = null

	private readonly _failureThreshold: number
	private readonly _successThreshold: number
	private readonly _resetTimeoutMs: number
	readonly name: string

	constructor(opts: CircuitBreakerOptions = {}) {
		super()
		this._failureThreshold = opts.failureThreshold ?? 5
		this._successThreshold = opts.successThreshold ?? 2
		this._resetTimeoutMs = opts.resetTimeoutMs ?? 30_000
		this.name = opts.name ?? 'circuit-breaker'
	}

	/** Current circuit state */
	get state(): CircuitState {
		return this._state
	}

	/** Whether the circuit is currently open (calls will be rejected) */
	get isOpen(): boolean {
		return this._state === 'open'
	}

	/**
	 * Execute a function through the circuit breaker.
	 * Throws a Boom-503 if the circuit is open.
	 */
	async exec<T>(fn: () => Promise<T>): Promise<T> {
		if (this._state === 'open') {
			this.emit('rejected', { name: this.name })
			throw new Boom(`Circuit breaker "${this.name}" is open`, { statusCode: 503 })
		}

		try {
			const result = await fn()
			this._onSuccess()
			return result
		} catch (err) {
			this._onFailure()
			throw err
		}
	}

	/** Manually reset the circuit to closed state */
	reset(): void {
		this._clearTimer()
		this._state = 'closed'
		this._failures = 0
		this._successes = 0
	}

	/** Destroy the circuit breaker, clearing all timers and listeners */
	destroy(): void {
		this._clearTimer()
		this.removeAllListeners()
	}

	// ─── Private state transitions ────────────────────────────────────────

	private _onSuccess(): void {
		if (this._state === 'closed') {
			// Reset failure counter on success
			this._failures = 0
			return
		}

		if (this._state === 'half-open') {
			this._successes++
			if (this._successes >= this._successThreshold) {
				this._toClose()
			}
		}
	}

	private _onFailure(): void {
		if (this._state === 'open') return

		this._failures++
		this._successes = 0

		if (this._failures >= this._failureThreshold) {
			this._toOpen()
		}
	}

	private _toOpen(): void {
		this._state = 'open'
		this.emit('open', { failures: this._failures })

		this._clearTimer()
		this._resetTimer = setTimeout(() => {
			this._toHalfOpen()
		}, this._resetTimeoutMs)
		this._resetTimer.unref()
	}

	private _toHalfOpen(): void {
		this._state = 'half-open'
		this._successes = 0
		this.emit('half-open')
	}

	private _toClose(): void {
		this._clearTimer()
		this._state = 'closed'
		this._failures = 0
		this._successes = 0
		this.emit('close', { successes: this._successes })
	}

	private _clearTimer(): void {
		if (this._resetTimer) {
			clearTimeout(this._resetTimer)
			this._resetTimer = null
		}
	}
}
