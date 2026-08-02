import { Router } from 'express'
import type { WAKitClient } from '../../client/WAKitClient'

/**
 * Session/status routes:
 * GET /status — connection state
 * GET /sessions — authenticated session info
 * GET /profile — authenticated user profile
 */
export function createSessionRoutes(client: WAKitClient): Router {
	const router = Router()

	/** GET /status — current connection state */
	router.get('/status', (_req, res) => {
		const user = client.user
		res.json({
			connected: user !== null,
			user: user
				? {
						jid: user.id,
						name: user.name,
						phone: user.id.split(':')[0]
					}
				: null
		})
	})

	/** GET /sessions — session details */
	router.get('/sessions', (_req, res) => {
		const user = client.user
		res.json({
			sessions: user
				? [
						{
							jid: user.id,
							name: user.name,
							active: true
						}
					]
				: []
		})
	})

	/** GET /profile — authenticated user profile */
	router.get('/profile', (_req, res) => {
		const user = client.user
		if (!user) {
			res.status(503).json({ error: 'Not Connected', message: 'WhatsApp session is not active.' })
			return
		}

		res.json({
			jid: user.id,
			name: user.name,
			phone: user.id.split(':')[0]
		})
	})

	return router
}
