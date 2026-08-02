import { Router } from 'express'
import { z } from 'zod'
import { Boom } from '@hapi/boom'
import { validate } from '../middleware/validate'
import type { WAKitClient } from '../../client/WAKitClient'

const sendMessageSchema = z.object({
	jid: z.string().min(1, 'jid is required'),
	text: z.string().optional(),
	image: z.object({ url: z.string() }).optional(),
	document: z.object({ url: z.string(), mimetype: z.string(), fileName: z.string() }).optional(),
	audio: z.object({ url: z.string() }).optional(),
	video: z.object({ url: z.string() }).optional(),
	caption: z.string().optional()
})

type SendMessageBody = z.infer<typeof sendMessageSchema>

/**
 * Message routes:
 * POST /messages/send — send text, image, document, audio, or video
 */
export function createMessageRoutes(client: WAKitClient): Router {
	const router = Router()

	/**
	 * @openapi
	 * /messages/send:
	 *   post:
	 *     summary: Send a WhatsApp message
	 *     description: Supports text, image, document, audio, and video messages.
	 */
	router.post('/messages/send', validate(sendMessageSchema), async (req, res, next) => {
		try {
			const body: SendMessageBody = req.body

			let content: import('../../Types').AnyMessageContent

			if (body.image) {
				content = { image: { url: body.image.url }, caption: body.caption }
			} else if (body.document) {
				content = {
					document: { url: body.document.url },
					mimetype: body.document.mimetype,
					fileName: body.document.fileName
				}
			} else if (body.audio) {
				content = { audio: { url: body.audio.url } }
			} else if (body.video) {
				content = { video: { url: body.video.url }, caption: body.caption }
			} else if (body.text) {
				content = { text: body.text }
			} else {
				throw new Boom('At least one of: text, image, document, audio, video must be provided.', {
					statusCode: 400
				})
			}

			const result = await client.sendMessage(body.jid, content)
			res.json({ success: true, key: result?.key })
		} catch (err) {
			next(err)
		}
	})

	return router
}
