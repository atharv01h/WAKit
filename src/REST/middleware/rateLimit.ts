import type { Request, Response, NextFunction } from 'express'
import type { RateLimitConfig } from '../types'

/**
 * Simple in-process sliding-window rate limiter.
 * Limits by IP address (`req.ip`).
 */
export function createRateLimitMiddleware(config: RateLimitConfig = {}) {
	const maxRequests = config.maxRequests ?? 100
	const windowMs = config.windowMs ?? 60_000

	const hits = new Map<string, number[]>()

	// Cleanup old windows periodically
	const cleanup = setInterval(() => {
		const cutoff = Date.now() - windowMs
		for (const [ip, timestamps] of hits) {
			const filtered = timestamps.filter(t => t > cutoff)
			if (filtered.length === 0) {
				hits.delete(ip)
			} else {
				hits.set(ip, filtered)
			}
		}
	}, windowMs)
	cleanup.unref()

	return (req: Request, res: Response, next: NextFunction): void => {
		const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
		const now = Date.now()
		const cutoff = now - windowMs

		const timestamps = (hits.get(ip) ?? []).filter(t => t > cutoff)

		if (timestamps.length >= maxRequests) {
			res.setHeader('Retry-After', Math.ceil(windowMs / 1000))
			res.status(429).json({
				error: 'Too Many Requests',
				message: `Rate limit exceeded. Max ${maxRequests} requests per ${windowMs / 1000}s.`
			})
			return
		}

		timestamps.push(now)
		hits.set(ip, timestamps)
		next()
	}
}
