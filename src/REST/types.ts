import type { Request, Response } from 'express'

// ─── REST API Config ──────────────────────────────────────────────────────────

/** Configuration for the WAKit REST API server */
export interface RestApiConfig {
	/** Port to listen on (default: 3000) */
	port?: number
	/** Host to bind to (default: '0.0.0.0') */
	host?: string
	/** API authentication configuration */
	auth?: AuthConfig
	/** Rate limiting configuration */
	rateLimit?: RateLimitConfig
	/** CORS configuration */
	cors?: CorsConfig
	/** Whether to serve Swagger UI at /docs (default: true) */
	swagger?: boolean
	/** API version prefix (default: 'v1') */
	apiVersion?: string
}

/** Authentication configuration */
export interface AuthConfig {
	/**
	 * API key for simple key-based authentication.
	 * Pass as `Authorization: Bearer <key>` or `X-Api-Key: <key>` header.
	 */
	apiKey?: string
	/**
	 * Multiple API keys (any key in this list will be accepted).
	 * If both apiKey and apiKeys are set, apiKeys takes precedence.
	 */
	apiKeys?: string[]
}

/** Rate limiting configuration */
export interface RateLimitConfig {
	/** Max requests per window per IP (default: 100) */
	maxRequests?: number
	/** Window size in ms (default: 60_000 = 1 minute) */
	windowMs?: number
}

/** CORS configuration */
export interface CorsConfig {
	/** Allowed origins. Defaults to '*' */
	origins?: string | string[]
	/** Allowed methods. Defaults to common set */
	methods?: string[]
}

// ─── Route Definition ─────────────────────────────────────────────────────────

/** A custom route that a plugin can register on the REST server */
export interface RouteDefinition {
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
	path: string
	description?: string
	handler: (req: Request, res: Response) => void | Promise<void>
}

// ─── OpenAPI types ────────────────────────────────────────────────────────────

export interface OpenApiSpec {
	openapi: '3.1.0'
	info: {
		title: string
		version: string
		description: string
	}
	paths: Record<string, Record<string, OpenApiOperation>>
}

export interface OpenApiOperation {
	summary: string
	description?: string
	requestBody?: {
		required: boolean
		content: Record<string, { schema: Record<string, unknown> }>
	}
	responses: Record<string, { description: string }>
	security?: Array<Record<string, unknown>>
}
