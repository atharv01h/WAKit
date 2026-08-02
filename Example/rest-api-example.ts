/**
 * REST API Example — WAKit by Atharv Hatwar
 *
 * Demonstrates:
 * - Enabling the REST API server
 * - API key authentication
 * - Swagger UI at /docs
 * - Custom plugin route registration
 *
 * Run: tsx Example/rest-api-example.ts
 * Then visit: http://localhost:3000/docs
 */
import { createClient } from '../src/index'
import pino from 'pino'

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } })

async function main() {
	const client = await createClient({
		auth: './session',
		rest: {
			port: 3000,
			auth: {
				apiKey: process.env['WAKIT_API_KEY'] ?? 'dev-secret-key'
			},
			rateLimit: {
				maxRequests: 60,
				windowMs: 60_000
			},
			cors: {
				origins: ['http://localhost:3000', 'https://yourdomain.com']
			},
			swagger: true
		}
	})

	// Register a custom route (e.g., from a plugin)
	client.api.registerRoute({
		method: 'GET',
		path: '/ping',
		description: 'Health check',
		handler: (_req, res) => {
			res.json({ pong: true, timestamp: new Date().toISOString() })
		}
	})

	// Start the server
	await client.api.start()
	logger.info(`REST API listening at ${client.api.baseUrl}`)
	logger.info(`Swagger UI: ${client.api.baseUrl}/docs`)
	logger.info(`OpenAPI spec: ${client.api.baseUrl}/openapi.json`)
	logger.info(`API Key: ${process.env['WAKIT_API_KEY'] ?? 'dev-secret-key'}`)

	client.on('connection.update', ({ qr, connection }) => {
		if (qr) logger.info('Scan QR code to connect')
		if (connection === 'open') logger.info('WhatsApp connected! REST API is ready.')
	})

	// Example: send a message via the REST API
	// curl -X POST http://localhost:3000/v1/messages/send \
	//   -H "X-Api-Key: dev-secret-key" \
	//   -H "Content-Type: application/json" \
	//   -d '{"jid":"1234567890@s.whatsapp.net","text":"Hello from REST!"}'
}

main().catch(console.error)
