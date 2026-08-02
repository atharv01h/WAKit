import type { Request, Response, NextFunction } from 'express'
import type { AuthConfig } from '../types'

/**
 * Express middleware that enforces API key authentication.
 * Accepts key via `Authorization: Bearer <key>` or `X-Api-Key: <key>`.
 * If no auth config is provided, all requests pass through.
 */
export function createAuthMiddleware(config?: AuthConfig) {
	return (req: Request, res: Response, next: NextFunction): void => {
		if (!config?.apiKey && (!config?.apiKeys || config.apiKeys.length === 0)) {
			next()
			return
		}

		const validKeys = config.apiKeys?.length ? config.apiKeys : config.apiKey ? [config.apiKey] : []

		const authHeader = req.headers['authorization']
		const apiKeyHeader = req.headers['x-api-key']

		let provided: string | undefined

		if (authHeader?.startsWith('Bearer ')) {
			provided = authHeader.slice(7)
		} else if (typeof apiKeyHeader === 'string') {
			provided = apiKeyHeader
		}

		if (!provided || !validKeys.includes(provided)) {
			res.status(401).json({
				error: 'Unauthorized',
				message: 'Valid API key required. Provide via Authorization: Bearer <key> or X-Api-Key: <key> header.'
			})
			return
		}

		next()
	}
}
