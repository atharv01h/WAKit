import express from 'express'
import type { Express, Router } from 'express'
import http from 'node:http'
import { Boom } from '@hapi/boom'
import type { WAKitClient } from '../client/WAKitClient'
import type { RestApiConfig, RouteDefinition } from './types'
import { createAuthMiddleware } from './middleware/auth'
import { createRateLimitMiddleware } from './middleware/rateLimit'
import { errorHandler } from './middleware/errorHandler'
import { createMessageRoutes } from './routes/messages'
import { createSessionRoutes } from './routes/sessions'
import { createGroupRoutes } from './routes/groups'
import { createContactRoutes } from './routes/contacts'

/**
 * WAKitRestServer exposes WAKit's capabilities as a versioned HTTP API.
 *
 * Built on Express with:
 * - API key authentication
 * - IP-based rate limiting
 * - Configurable CORS
 * - Zod body validation on all routes
 * - OpenAPI 3.1 spec at /openapi.json
 * - Swagger UI at /docs
 * - Plugin-extensible route registration
 *
 * @example
 * ```ts
 * const client = await createClient({ auth: './session' })
 * await client.api.enable({ port: 3000, auth: { apiKey: 'my-secret' } })
 * // REST API now available at http://localhost:3000/v1/
 * ```
 */
export class WAKitRestServer {
	private readonly _app: Express
	private _server: http.Server | null = null
	private readonly _config: Required<Omit<RestApiConfig, 'auth' | 'rateLimit' | 'cors'>> &
		Pick<RestApiConfig, 'auth' | 'rateLimit' | 'cors'>
	private readonly _customRoutes: RouteDefinition[] = []
	private readonly _client: WAKitClient

	constructor(client: WAKitClient, config: RestApiConfig = {}) {
		this._client = client
		this._config = {
			port: config.port ?? 3000,
			host: config.host ?? '0.0.0.0',
			swagger: config.swagger ?? true,
			apiVersion: config.apiVersion ?? 'v1',
			auth: config.auth,
			rateLimit: config.rateLimit,
			cors: config.cors
		}
		this._app = this._buildApp()
	}

	/** The port this server is configured to listen on */
	get port(): number {
		return this._config.port
	}

	/** Base URL once server is started */
	get baseUrl(): string {
		return `http://${this._config.host === '0.0.0.0' ? 'localhost' : this._config.host}:${this._config.port}`
	}

	/** Whether the server is currently running */
	get isRunning(): boolean {
		return this._server !== null
	}

	/**
	 * Register a custom route on the API server.
	 * Plugin-registered routes are prefixed with the API version automatically.
	 *
	 * @example
	 * ```ts
	 * client.api.registerRoute({
	 *   method: 'GET',
	 *   path: '/ping',
	 *   handler: (_req, res) => res.json({ pong: true })
	 * })
	 * ```
	 */
	registerRoute(def: RouteDefinition): void {
		this._customRoutes.push(def)
		// If already started, mount the route dynamically
		if (this._server) {
			this._mountCustomRoute(this._app, def, this._config.apiVersion)
		}
	}

	/**
	 * Start the HTTP server.
	 * Resolves when the server is listening.
	 * Throws if already started.
	 */
	async start(): Promise<void> {
		if (this._server) {
			throw new Boom('REST API server is already running.', { statusCode: 409 })
		}

		return new Promise((resolve, reject) => {
			this._server = http.createServer(this._app)
			this._server.listen(this._config.port, this._config.host, () => resolve())
			this._server.on('error', reject)
		})
	}

	/**
	 * Gracefully stop the HTTP server.
	 * Resolves when all connections are closed.
	 */
	async stop(): Promise<void> {
		if (!this._server) return

		return new Promise((resolve, reject) => {
			this._server!.close(err => {
				if (err) {
					reject(err)
				} else {
					this._server = null
					resolve()
				}
			})
		})
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	private _buildApp(): Express {
		const app = express()
		const version = this._config.apiVersion

		// JSON body parsing
		app.use(express.json({ limit: '10mb' }))
		app.use(express.urlencoded({ extended: true }))

		// CORS
		app.use((req, res, next) => {
			const corsConfig = this._config.cors
			const origin = corsConfig?.origins
				? Array.isArray(corsConfig.origins)
					? corsConfig.origins.join(', ')
					: corsConfig.origins
				: '*'

			res.setHeader('Access-Control-Allow-Origin', origin)
			res.setHeader(
				'Access-Control-Allow-Methods',
				corsConfig?.methods?.join(', ') ?? 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
			)
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key')

			if (req.method === 'OPTIONS') {
				res.sendStatus(204)
				return
			}

			next()
		})

		// Rate limiting (global)
		if (this._config.rateLimit) {
			app.use(createRateLimitMiddleware(this._config.rateLimit))
		}

		// Health check (no auth)
		app.get('/health', (_req, res) => {
			res.json({ status: 'ok', timestamp: new Date().toISOString() })
		})

		// OpenAPI spec
		app.get('/openapi.json', (_req, res) => {
			res.json(this._generateOpenApiSpec())
		})

		// Swagger UI (served inline — no CDN dependency)
		if (this._config.swagger) {
			app.get('/docs', (_req, res) => {
				res.setHeader('Content-Type', 'text/html')
				res.send(this._swaggerHtml())
			})
		}

		// API key auth on all /v1 routes
		const apiRouter = express.Router() as Router
		apiRouter.use(createAuthMiddleware(this._config.auth))

		// Core routes
		apiRouter.use('/', createMessageRoutes(this._client))
		apiRouter.use('/', createSessionRoutes(this._client))
		apiRouter.use('/', createGroupRoutes(this._client))
		apiRouter.use('/', createContactRoutes(this._client))

		// Custom plugin routes
		for (const route of this._customRoutes) {
			this._mountCustomRoute(apiRouter, route, '')
		}

		app.use(`/${version}`, apiRouter)

		// 404 handler
		app.use((_req, res) => {
			res.status(404).json({
				error: 'Not Found',
				message: 'The requested endpoint does not exist.'
			})
		})

		// Error handler (must be last)
		app.use(errorHandler)

		return app
	}

	private _mountCustomRoute(target: Express | Router, def: RouteDefinition, prefix: string): void {
		const path = prefix ? `/${prefix}${def.path.startsWith('/') ? def.path : `/${def.path}`}` : def.path
		const handler: express.RequestHandler = async (req, res, next) => {
			try {
				await def.handler(req, res)
			} catch (err) {
				next(err)
			}
		}

		const routerTarget = target as express.Router
		switch (def.method) {
			case 'GET':
				routerTarget.get(path, handler)
				break
			case 'POST':
				routerTarget.post(path, handler)
				break
			case 'PUT':
				routerTarget.put(path, handler)
				break
			case 'PATCH':
				routerTarget.patch(path, handler)
				break
			case 'DELETE':
				routerTarget.delete(path, handler)
				break
		}
	}

	private _generateOpenApiSpec(): object {
		const version = this._config.apiVersion
		const hasAuth = !!this._config.auth?.apiKey || !!this._config.auth?.apiKeys?.length

		return {
			openapi: '3.1.0',
			info: {
				title: 'WAKit REST API',
				version: '1.0.0',
				description: 'REST API for WAKit — the WhatsApp SDK by Atharv Hatwar'
			},
			servers: [{ url: `${this.baseUrl}/${version}` }],
			...(hasAuth
				? {
						components: {
							securitySchemes: {
								BearerAuth: { type: 'http', scheme: 'bearer' },
								ApiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-Api-Key' }
							}
						},
						security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }]
					}
				: {}),
			paths: {
				'/messages/send': {
					post: {
						summary: 'Send a WhatsApp message',
						description: 'Send text, image, document, audio, or video to a JID.',
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['jid'],
										properties: {
											jid: { type: 'string', example: '1234567890@s.whatsapp.net' },
											text: { type: 'string', example: 'Hello World' },
											image: {
												type: 'object',
												properties: { url: { type: 'string' } }
											},
											document: {
												type: 'object',
												properties: {
													url: { type: 'string' },
													mimetype: { type: 'string' },
													fileName: { type: 'string' }
												}
											},
											audio: { type: 'object', properties: { url: { type: 'string' } } },
											video: { type: 'object', properties: { url: { type: 'string' } } },
											caption: { type: 'string' }
										}
									}
								}
							}
						},
						responses: {
							'200': { description: 'Message sent' },
							'400': { description: 'Validation error' },
							'401': { description: 'Unauthorized' }
						}
					}
				},
				'/status': {
					get: {
						summary: 'Connection status',
						responses: { '200': { description: 'Connection state' } }
					}
				},
				'/sessions': {
					get: {
						summary: 'Active sessions',
						responses: { '200': { description: 'List of sessions' } }
					}
				},
				'/profile': {
					get: {
						summary: 'Authenticated user profile',
						responses: {
							'200': { description: 'User profile' },
							'503': { description: 'Not connected' }
						}
					}
				},
				'/groups/{jid}': {
					get: {
						summary: 'Group metadata',
						parameters: [{ name: 'jid', in: 'path', required: true, schema: { type: 'string' } }],
						responses: {
							'200': { description: 'Group metadata' },
							'500': { description: 'Group not found or fetch failed' }
						}
					}
				},
				'/contacts/check': {
					get: {
						summary: 'Check if phones are on WhatsApp',
						parameters: [
							{
								name: 'phones',
								in: 'query',
								required: true,
								schema: { type: 'string' },
								description: 'Comma-separated phone numbers'
							}
						],
						responses: { '200': { description: 'WhatsApp check results' } }
					}
				}
			}
		}
	}

	private _swaggerHtml(): string {
		const specUrl = `${this.baseUrl}/openapi.json`
		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WAKit REST API — Swagger UI</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    url: '${specUrl}',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true
  })
</script>
</body>
</html>`
	}
}
