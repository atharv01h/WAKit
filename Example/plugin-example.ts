/**
 * Plugin Example — WAKit by Atharv Hatwar
 *
 * Demonstrates:
 * - Using built-in LoggerPlugin and WebhookPlugin
 * - Writing a custom plugin with all lifecycle hooks
 * - Plugin dependencies
 * - Plugin reload
 */
import { createClient, definePlugin, LoggerPlugin, WebhookPlugin } from '../src/index'
import pino from 'pino'

const logger = pino({ level: 'debug', transport: { target: 'pino-pretty' } })

// ─── Custom analytics plugin ──────────────────────────────────────────────────
const analyticsPlugin = definePlugin({
	name: 'analytics',
	version: '1.0.0',
	author: 'Atharv Hatwar',
	description: 'Counts received messages',
	permissions: ['messages:read'],
	requires: ['wakit-logger-plugin'], // depends on the logger plugin being installed first

	async initialize(client) {
		logger.info('Analytics plugin: initializing...')
		// Could set up external DB connection here
	},

	async install(client) {
		let msgCount = 0
		client.on('messages.upsert', ({ messages, type }) => {
			if (type === 'notify') {
				msgCount += messages.length
				logger.info({ total: msgCount }, 'Analytics: messages received')
			}
		})
	},

	async ready(client) {
		logger.info('Analytics plugin: all plugins ready, starting analytics collection')
	},

	async uninstall(client) {
		logger.info('Analytics plugin: cleaning up')
	}
})

async function main() {
	const client = await createClient({ auth: './session' })

	// Install built-in logger plugin first (analytics depends on it)
	await client.use(LoggerPlugin({ logger, events: ['connection.update', 'messages.upsert'] }))

	// Install webhook plugin — forwards messages to a local endpoint
	await client.use(WebhookPlugin({
		url: 'http://localhost:4000/webhook',
		events: ['messages.upsert', 'connection.update'],
		timeoutMs: 3000,
		maxRetries: 1
	}))

	// Install analytics plugin (depends on logger)
	await client.use(analyticsPlugin)

	// Signal that all plugins are ready
	await client.pluginsReady()

	logger.info('All plugins installed:', client.plugins.map(p => p.name))

	// Reload analytics plugin after 60 seconds
	setTimeout(async () => {
		logger.info('Reloading analytics plugin...')
		await client.reloadPlugin('analytics')
		logger.info('Analytics plugin reloaded')
	}, 60_000)

	client.on('connection.update', ({ qr }) => {
		if (qr) logger.info({ qr }, 'Scan QR')
	})
}

main().catch(console.error)
