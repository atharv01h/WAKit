/**
 * Middleware Example — WAKit by Atharv Hatwar
 *
 * Demonstrates:
 * - Incoming & outgoing middleware pipelines
 * - Named middleware with enable/disable
 * - Group-scoped pipelines
 * - Built-in middleware: dedup, rate-limit, filter, error logging
 */
import { createClient, dedupMiddleware, rateLimitMiddleware, filterJidMiddleware, errorLoggingMiddleware, createGroupPipeline } from '../src/index'
import pino from 'pino'

const logger = pino({ level: 'debug', transport: { target: 'pino-pretty' } })

async function main() {
	const client = await createClient({ auth: './session' })

	// ─── Deduplication ───────────────────────────────────────────────────────
	const dedupId = client.useIncoming(dedupMiddleware(), 'dedup')
	logger.info({ dedupId }, 'Dedup middleware registered')

	// ─── Rate limiting: 30 messages/minute per JID ───────────────────────────
	client.useIncoming(
		rateLimitMiddleware({
			maxPerWindow: 30,
			windowMs: 60_000,
			onLimitExceeded: ctx => logger.warn({ jid: ctx.remoteJid }, 'Rate limit hit')
		}),
		'rate-limit'
	)

	// ─── Drop broadcast messages ─────────────────────────────────────────────
	client.useIncoming(filterJidMiddleware(jid => jid.endsWith('@broadcast')), 'no-broadcasts')

	// ─── Error logging ───────────────────────────────────────────────────────
	client.incomingPipeline.useError(errorLoggingMiddleware(logger))

	// ─── Group-scoped pipeline ───────────────────────────────────────────────
	const supportGroup = createGroupPipeline('support-group@g.us')
	supportGroup.use(async (ctx, next) => {
		logger.info({ msgId: ctx.message.key.id }, 'Support group message')
		await next()
	})
	client.useIncoming(supportGroup.asMiddleware(), 'support-group')

	// ─── Custom incoming middleware ───────────────────────────────────────────
	client.useIncoming(async (ctx, next) => {
		logger.debug({ jid: ctx.remoteJid }, 'Incoming message before processing')
		await next()
		logger.debug({ dropped: ctx.drop }, 'Incoming message after processing')
	}, 'my-logger')

	// ─── Outgoing middleware — add timestamp to text messages ────────────────
	client.useOutgoing(async (ctx, next) => {
		if ('text' in ctx.content && ctx.content.text) {
			// Prepend timestamp for demo
		}

		await next()
	}, 'outgoing-stamper')

	// ─── Disable rate limiting dynamically ───────────────────────────────────
	setTimeout(() => {
		logger.info('Disabling rate-limit middleware for admin mode')
		client.incomingPipeline.disable('rate-limit')
	}, 30_000)

	client.on('connection.update', ({ qr, connection }) => {
		if (qr) logger.info({ qr }, 'Scan this QR code')
		if (connection === 'open') logger.info('Connected!')
	})

	client.on('messages.upsert', ({ messages, type }) => {
		if (type === 'notify') {
			for (const msg of messages) {
				logger.info({ from: msg.key.remoteJid, id: msg.key.id }, 'Message received')
			}
		}
	})
}

main().catch(console.error)
