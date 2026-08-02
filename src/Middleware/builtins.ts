import { LRUCache } from 'lru-cache'
import type { ILogger } from '../Utils/logger'
import type { IncomingMessageContext, Middleware, OutgoingMessageContext, ErrorMiddleware } from './types'

// ─── Logging Middleware ───────────────────────────────────────────────────────

/**
 * Logs incoming messages at debug level with structured metadata.
 * Zero-overhead: only active when logger level is debug or lower.
 */
export function incomingLoggingMiddleware(logger: ILogger): Middleware<IncomingMessageContext> {
	return async (ctx, next) => {
		const start = Date.now()
		await next()
		if (logger.level !== 'debug' && logger.level !== 'trace') {
			return
		}

		logger.debug(
			{
				jid: ctx.remoteJid,
				msgId: ctx.message.key.id,
				fromMe: ctx.message.key.fromMe,
				dropped: ctx.drop,
				durationMs: Date.now() - start
			},
			'wakit: incoming message processed'
		)
	}
}

/**
 * Logs outgoing messages at debug level with structured metadata.
 */
export function outgoingLoggingMiddleware(logger: ILogger): Middleware<OutgoingMessageContext> {
	return async (ctx, next) => {
		const start = Date.now()
		await next()
		if (logger.level !== 'debug' && logger.level !== 'trace') {
			return
		}

		logger.debug(
			{
				jid: ctx.jid,
				aborted: ctx.abort,
				durationMs: Date.now() - start
			},
			'wakit: outgoing message processed'
		)
	}
}

// ─── Rate Limit Middleware ────────────────────────────────────────────────────

export interface RateLimitOptions {
	/** Maximum messages per window per JID (default: 60) */
	maxPerWindow?: number
	/** Window size in ms (default: 60_000 = 1 minute) */
	windowMs?: number
	/** Called when rate limit is exceeded. If not provided, message is dropped silently */
	onLimitExceeded?: (ctx: IncomingMessageContext) => void
}

/**
 * Per-JID sliding-window rate limiter for incoming messages.
 * Drops (ctx.drop = true) messages that exceed the limit.
 *
 * @example
 * ```ts
 * client.useIncoming(rateLimitMiddleware({ maxPerWindow: 10, windowMs: 5000 }))
 * ```
 */
export function rateLimitMiddleware(opts: RateLimitOptions = {}): Middleware<IncomingMessageContext> {
	const maxPerWindow = opts.maxPerWindow ?? 60
	const windowMs = opts.windowMs ?? 60_000

	// Map<jid, timestamps[]>
	const windows = new Map<string, number[]>()

	// Periodically clean up stale entries to prevent memory leak
	const cleanup = setInterval(() => {
		const cutoff = Date.now() - windowMs
		for (const [jid, timestamps] of windows) {
			const filtered = timestamps.filter(t => t > cutoff)
			if (filtered.length === 0) {
				windows.delete(jid)
			} else {
				windows.set(jid, filtered)
			}
		}
	}, windowMs)
	// Unref so this timer doesn't keep the process alive
	cleanup.unref()

	return async (ctx, next) => {
		const now = Date.now()
		const cutoff = now - windowMs
		const jid = ctx.remoteJid

		let timestamps = windows.get(jid) ?? []
		// Remove expired entries
		timestamps = timestamps.filter(t => t > cutoff)

		if (timestamps.length >= maxPerWindow) {
			ctx.drop = true
			opts.onLimitExceeded?.(ctx)
			return
		}

		timestamps.push(now)
		windows.set(jid, timestamps)

		await next()
	}
}

// ─── JID Filter Middleware ────────────────────────────────────────────────────

/**
 * Drops incoming messages from JIDs that match the predicate.
 *
 * @example
 * ```ts
 * client.useIncoming(filterJidMiddleware(jid => isJidBroadcast(jid)))
 * ```
 */
export function filterJidMiddleware(predicate: (jid: string) => boolean): Middleware<IncomingMessageContext> {
	return async (ctx, next) => {
		if (predicate(ctx.remoteJid)) {
			ctx.drop = true
			return
		}

		await next()
	}
}

// ─── Metrics Middleware ───────────────────────────────────────────────────────

export interface SimpleMetricsCollector {
	increment(metric: string, labels?: Record<string, string>): void
	timing(metric: string, ms: number, labels?: Record<string, string>): void
}

/**
 * Collects basic counts and latency metrics for incoming messages.
 * Works with any collector implementing the SimpleMetricsCollector interface.
 *
 * @example
 * ```ts
 * const collector = { increment: console.log, timing: console.log }
 * client.useIncoming(metricsMiddleware(collector))
 * ```
 */
export function incomingMetricsMiddleware(collector: SimpleMetricsCollector): Middleware<IncomingMessageContext> {
	return async (ctx, next) => {
		const start = Date.now()
		await next()
		const ms = Date.now() - start
		collector.increment('wakit.messages.received', { dropped: String(ctx.drop) })
		collector.timing('wakit.messages.processing_ms', ms)
	}
}

/**
 * Collects basic counts and latency metrics for outgoing messages.
 */
export function outgoingMetricsMiddleware(collector: SimpleMetricsCollector): Middleware<OutgoingMessageContext> {
	return async (ctx, next) => {
		const start = Date.now()
		await next()
		const ms = Date.now() - start
		collector.increment('wakit.messages.sent', { aborted: String(ctx.abort) })
		collector.timing('wakit.messages.send_ms', ms)
	}
}

// ─── Error Logging Middleware ─────────────────────────────────────────────────

/**
 * Error middleware that logs any error thrown by upstream middleware.
 * Register via `pipeline.useError(errorLoggingMiddleware(logger))`.
 *
 * @example
 * ```ts
 * const pipeline = createPipeline<IncomingMessageContext>()
 * pipeline.useError(errorLoggingMiddleware(logger))
 * pipeline.use(myMiddleware)
 * ```
 */
export function errorLoggingMiddleware(logger: ILogger): ErrorMiddleware<IncomingMessageContext> {
	return async (err, ctx, next) => {
		logger.error(
			{
				err,
				jid: ctx.remoteJid,
				msgId: ctx.message.key.id
			},
			'wakit: unhandled middleware error'
		)
		await next()
	}
}

// ─── Deduplication Middleware ─────────────────────────────────────────────────

export interface DedupOptions {
	/**
	 * Maximum number of message IDs to remember (default: 1000).
	 * Older IDs are evicted automatically via LRU.
	 */
	maxSeen?: number
}

/**
 * Drops duplicate incoming messages based on `message.key.id`.
 * Uses an LRU cache to bound memory usage.
 *
 * This is useful when WhatsApp delivers the same message twice (common after
 * reconnects or multi-device sync events).
 *
 * @example
 * ```ts
 * client.useIncoming(dedupMiddleware())
 * ```
 */
export function dedupMiddleware(opts: DedupOptions = {}): Middleware<IncomingMessageContext> {
	const maxSeen = opts.maxSeen ?? 1000
	const seen = new LRUCache<string, true>({ max: maxSeen })

	return async (ctx, next) => {
		const id = ctx.message.key.id
		if (!id) {
			await next()
			return
		}

		if (seen.has(id)) {
			ctx.drop = true
			return
		}

		seen.set(id, true)
		await next()
	}
}
