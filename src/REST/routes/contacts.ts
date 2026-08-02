import { Router } from 'express'
import type { WAKitClient } from '../../client/WAKitClient'

/**
 * Contacts routes:
 * GET /contacts/check?phones=... — check if phone numbers are on WhatsApp
 */
export function createContactRoutes(client: WAKitClient): Router {
	const router = Router()

	/**
	 * GET /contacts/check?phones=123,456
	 * Checks if the given phone numbers (comma-separated) are on WhatsApp.
	 */
	router.get('/contacts/check', async (req, res, next) => {
		try {
			const raw = req.query['phones']
			if (typeof raw !== 'string' || !raw) {
				res.status(400).json({
					error: 'Bad Request',
					message: 'Query parameter "phones" is required (comma-separated phone numbers).'
				})
				return
			}

			const phones = raw
				.split(',')
				.map(p => p.trim())
				.filter(Boolean)
			const results = await client.onWhatsApp(...phones)
			res.json({ results })
		} catch (err) {
			next(err)
		}
	})

	return router
}
