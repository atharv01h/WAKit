import { definePlugin } from '../types'
import type { WAKitEventMap } from '../../Types'

export interface WebhookPluginOptions {
	/** The URL to POST events to */
	url: string
	/** Events to forward. Defaults to messages.upsert and connection.update */
	events?: Array<keyof WAKitEventMap>
	/**
	 * Optional secret for HMAC-SHA256 request signing.
	 * Sent as `X-WAKit-Signature` header.
	 */
	secret?: string
	/** Custom HTTP headers to include in every webhook request */
	headers?: Record<string, string>
	/** Timeout in ms for each webhook call (default: 5000) */
	timeoutMs?: number
	/** Max retries on network failure (default: 2) */
	maxRetries?: number
}

const DEFAULT_EVENTS: Array<keyof WAKitEventMap> = ['messages.upsert', 'connection.update']

/**
 * Built-in webhook plugin. Forwards selected WAKit events to an HTTP endpoint.
 *
 * Each event is POSTed as JSON:
 * ```json
 * { "event": "messages.upsert", "data": {...}, "timestamp": "2024-01-01T00:00:00.000Z" }
 * ```
 *
 * @example
 * ```ts
 * await client.use(WebhookPlugin({
 *   url: 'https://my-server.com/webhooks/whatsapp',
 *   events: ['messages.upsert', 'call'],
 *   secret: process.env.WEBHOOK_SECRET
 * }))
 * ```
 */
export function WebhookPlugin(opts: WebhookPluginOptions) {
	const webhookEvents = opts.events ?? DEFAULT_EVENTS
	const timeoutMs = opts.timeoutMs ?? 5_000
	const maxRetries = opts.maxRetries ?? 2

	async function send(event: keyof WAKitEventMap, data: unknown): Promise<void> {
		const body = JSON.stringify({ event, data, timestamp: new Date().toISOString() })

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'X-WAKit-Event': event,
			...opts.headers
		}

		// HMAC signing
		if (opts.secret) {
			const { createHmac } = await import('node:crypto')
			const sig = createHmac('sha256', opts.secret).update(body).digest('hex')
			headers['X-WAKit-Signature'] = `sha256=${sig}`
		}

		let lastErr: unknown
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const ctrl = new AbortController()
				const timer = setTimeout(() => ctrl.abort(), timeoutMs)
				try {
					const res = await fetch(opts.url, {
						method: 'POST',
						headers,
						body,
						signal: ctrl.signal
					})

					if (!res.ok) {
						throw new Error(`Webhook responded with ${res.status}`)
					}

					return
				} finally {
					clearTimeout(timer)
				}
			} catch (err) {
				lastErr = err
				if (attempt < maxRetries) {
					await new Promise(r => setTimeout(r, 200 * (attempt + 1)))
				}
			}
		}

		// Log but don't crash — webhook failures should not break the bot

		console.error('[WebhookPlugin] Failed to deliver webhook after retries:', lastErr)
	}

	return definePlugin({
		name: 'wakit-webhook-plugin',
		version: '1.0.0',
		author: 'Atharv Hatwar',
		description: 'Forwards WAKit events to an HTTP webhook endpoint',
		permissions: ['messages:read'],

		async install(client) {
			for (const event of webhookEvents) {
				client.on(event, (data: WAKitEventMap[keyof WAKitEventMap]) => {
					void send(event, data)
				})
			}
		}
	})
}
