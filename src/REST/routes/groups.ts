import { Router } from 'express'
import type { WAKitClient } from '../../client/WAKitClient'

/**
 * Group routes:
 * GET /groups/:jid — metadata for a specific group
 */
export function createGroupRoutes(client: WAKitClient): Router {
	const router = Router()

	/** GET /groups/:jid — fetch group metadata */
	router.get('/groups/:jid', async (req, res, next) => {
		try {
			const { jid } = req.params
			if (!jid) {
				res.status(400).json({ error: 'Bad Request', message: 'Group JID is required.' })
				return
			}

			const metadata = await client.groupMetadata(decodeURIComponent(jid))
			res.json(metadata)
		} catch (err) {
			next(err)
		}
	})

	return router
}
