/**
 * Event Recorder & Replay Example — WAKit by Atharv Hatwar
 *
 * Demonstrates:
 * - Recording a WhatsApp session to a JSON file
 * - Replaying at different speeds
 * - Filtering specific event types
 * - Step-by-step replay
 * - Using recorded sessions for debugging without a live connection
 *
 * Run: tsx Example/recorder-example.ts
 */
import { createClient, WAKitRecorder } from '../src/index'
import pino from 'pino'

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } })
const SESSION_PATH = './debug-session.json'

async function main() {
	const client = await createClient({ auth: './session' })

	// ─── Start recording ─────────────────────────────────────────────────────
	client.recorder.start()
	logger.info('Recording started. Interact with WhatsApp...')

	client.on('connection.update', ({ qr, connection }) => {
		if (qr) logger.info('Scan QR to connect')
		if (connection === 'open') logger.info('Connected! Recording all events.')
	})

	// ─── Stop after 60 seconds and save ──────────────────────────────────────
	setTimeout(async () => {
		const session = client.recorder.stop()
		logger.info({ events: session.events.length }, 'Recording stopped')

		await client.recorder.save(SESSION_PATH, session)
		logger.info(`Session saved to ${SESSION_PATH}`)

		// ─── Replay at 2x speed ───────────────────────────────────────────────
		logger.info('--- Replay at 2x speed ---')
		await client.recorder.replay(session, {
			speed: 2,
			onEvent: (entry, idx) => logger.info({ idx, event: entry.event }, 'Replaying')
		})

		// ─── Replay only messages, instantly ─────────────────────────────────
		logger.info('--- Replay messages only (instant) ---')
		await client.recorder.replay(session, {
			speed: 0,
			filter: ['messages.upsert'],
			onEvent: (entry, idx) => {
				const data = entry.data as { messages: Array<{ key: { remoteJid?: string } }> }
				logger.info({
					idx,
					from: data.messages[0]?.key.remoteJid
				}, 'Replaying message')
			}
		})

		// ─── Step-by-step replay (first 5 events) ────────────────────────────
		logger.info('--- Step-by-step replay (first 5 events) ---')
		await client.recorder.replay(session, {
			stepByStep: true,
			toIndex: 4,
			onEvent: (entry, idx) => logger.info({ idx, event: entry.event }, '[step]')
		})

		// ─── Load from file and replay ────────────────────────────────────────
		logger.info(`--- Load from ${SESSION_PATH} and replay ---`)
		const loaded = await client.recorder.load(SESSION_PATH)
		logger.info({ events: loaded.events.length, recordedAt: loaded.recordedAt }, 'Loaded session')

		await client.recorder.replay(loaded, {
			speed: 5, // 5x speed
			filter: ['connection.update', 'creds.update']
		})

		logger.info('All replay demos complete')
		process.exit(0)
	}, 60_000)
}

// ─── Offline replay example (no live connection needed) ───────────────────────
async function offlineReplay() {
	const recorder = new WAKitRecorder()
	// Wire it to a mock emitter (useful in test environments)
	recorder._wire(
		() => {}, // no-op on
		() => {}, // no-op off
		(event, data) => logger.info({ event, data }, 'Offline replay event')
	)

	const session = await recorder.load(SESSION_PATH)
	await recorder.replay(session, { speed: 0 })
}

if (process.argv[2] === '--offline') {
	offlineReplay().catch(console.error)
} else {
	main().catch(console.error)
}
