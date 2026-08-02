/**
 * Scheduler Example — WAKit by Atharv Hatwar
 *
 * Demonstrates:
 * - Cron scheduling (everyMinute, everyHour, daily, weekly, cron)
 * - Message scheduling (send at a future time)
 * - Job pause/resume/cancel
 * - Job persistence across restarts
 * - Timezone support
 *
 * Run: tsx Example/scheduler-example.ts
 */
import { createClient } from '../src/index'
import pino from 'pino'

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } })

const MY_JID = '1234567890@s.whatsapp.net' // replace with real JID

async function main() {
	const client = await createClient({
		auth: './session',
		scheduler: {
			persistencePath: './scheduler-state.json',
			defaultTimezone: 'Asia/Kolkata'
		}
	})

	// Restore any persistent jobs from the previous run
	await client.scheduler.loadState()

	// ─── Heartbeat: every minute ─────────────────────────────────────────────
	const heartbeatId = client.scheduler.everyMinute(async () => {
		logger.info('Heartbeat tick')
	}, { name: 'heartbeat' })

	// ─── Daily morning greeting at 9 AM IST ──────────────────────────────────
	client.scheduler.daily('09:00', async () => {
		await client.sendMessage(MY_JID, { text: 'Good morning! Have a great day 🌅' })
	}, {
		name: 'morning-greeting',
		timezone: 'Asia/Kolkata',
		persistent: true // will survive restarts
	})

	// ─── Weekly report on Mondays ─────────────────────────────────────────────
	client.scheduler.weekly('monday', '10:00', async () => {
		await client.sendMessage(MY_JID, { text: 'Weekly report time!' })
	}, { name: 'weekly-report' })

	// ─── Custom cron: every 5 minutes on weekdays ────────────────────────────
	client.scheduler.cron('*/5 * * * 1-5', async (jobId) => {
		logger.info({ jobId }, 'Weekday 5-minute check')
	}, { name: 'weekday-check', maxRetries: 2 })

	// ─── Schedule a one-time message 10 seconds from now ────────────────────
	const sendAt = new Date(Date.now() + 10_000)
	const scheduledId = client.scheduler.send(
		MY_JID,
		{ text: 'This message was scheduled 10 seconds ago!' },
		sendAt,
		{ name: 'demo-scheduled-send' }
	)
	logger.info({ scheduledId, at: sendAt.toISOString() }, 'Message scheduled')

	// ─── Pause heartbeat after 30 seconds ────────────────────────────────────
	setTimeout(() => {
		client.scheduler.pause(heartbeatId)
		logger.info('Heartbeat paused')

		setTimeout(() => {
			client.scheduler.resume(heartbeatId)
			logger.info('Heartbeat resumed')
		}, 15_000)
	}, 30_000)

	// ─── Save state before exit ───────────────────────────────────────────────
	process.on('SIGINT', async () => {
		await client.scheduler.saveState()
		logger.info('Scheduler state saved. Jobs count:', client.scheduler.list().length)
		process.exit(0)
	})

	// Display all jobs
	logger.info('Registered jobs:', client.scheduler.list().map(j => ({ id: j.id, name: j.name, cron: j.cronExpression })))

	client.on('connection.update', ({ qr, connection }) => {
		if (qr) logger.info('Scan QR to connect')
		if (connection === 'open') logger.info('Connected! Scheduler is running.')
	})
}

main().catch(console.error)
