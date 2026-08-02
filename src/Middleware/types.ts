import type { WAMessage, AnyMessageContent } from '../Types'
import type { MiscMessageGenerationOptions } from '../Types/Message'

// ─── Core Middleware Types ────────────────────────────────────────────────────

/**
 * A middleware function that processes a context object and calls next() to
 * pass control to the next middleware in the pipeline.
 *
 * @example
 * ```ts
 * const logMiddleware: Middleware<IncomingMessageContext> = async (ctx, next) => {
 *   console.log('received:', ctx.message.key.id)
 *   await next()
 * }
 * ```
 */
export type Middleware<TContext> = (ctx: TContext, next: () => Promise<void>) => Promise<void>

/**
 * An error-handling middleware function. Called when a normal middleware throws.
 * Receives the error plus the context and next function.
 *
 * @example
 * ```ts
 * const errorMw: ErrorMiddleware<IncomingMessageContext> = async (err, ctx, next) => {
 *   console.error('middleware error:', err)
 *   await next() // optionally continue chain
 * }
 * ```
 */
export type ErrorMiddleware<TContext> = (err: unknown, ctx: TContext, next: () => Promise<void>) => Promise<void>

/**
 * A named middleware entry — same as Middleware but with an optional
 * identifier for later removal or toggling.
 */
export interface NamedMiddlewareEntry<TContext> {
	id: string
	fn: Middleware<TContext>
	enabled: boolean
}

/**
 * A composed middleware pipeline. Use `.use()` to add middleware
 * and `.execute()` to run the pipeline against a context.
 */
export interface MiddlewarePipeline<TContext> {
	/**
	 * Add a middleware to the end of the pipeline.
	 * @param middleware The middleware function to add.
	 * @param id Optional identifier for later removal/toggling. Auto-generated if omitted.
	 * @returns The assigned id.
	 */
	use(middleware: Middleware<TContext>, id?: string): string
	/**
	 * Add an error-handling middleware. Error middleware runs when a preceding
	 * middleware throws, and does NOT run in the normal flow.
	 */
	useError(middleware: ErrorMiddleware<TContext>): void
	/**
	 * Remove a middleware by its id.
	 * @returns true if a middleware with that id was found and removed.
	 */
	remove(id: string): boolean
	/**
	 * Disable a middleware by id without removing it.
	 * Disabled middleware are skipped during execution.
	 * @returns true if found.
	 */
	disable(id: string): boolean
	/**
	 * Re-enable a previously disabled middleware by id.
	 * @returns true if found.
	 */
	enable(id: string): boolean
	/**
	 * Execute all middleware in registration order against the given context.
	 * If no middleware is registered, this is a zero-overhead no-op.
	 */
	execute(ctx: TContext): Promise<void>
	/** Whether any middleware has been registered */
	readonly hasMiddleware: boolean
	/** Returns a snapshot of all registered middleware entries */
	entries(): ReadonlyArray<Readonly<NamedMiddlewareEntry<TContext>>>
}

// ─── Incoming Message Context ─────────────────────────────────────────────────

/** Context passed to every incoming message middleware */
export interface IncomingMessageContext {
	/** The decrypted WAMessage as received from WhatsApp */
	readonly message: WAMessage
	/** The JID the message was received from */
	readonly remoteJid: string
	/**
	 * Set to true in middleware to prevent the message from being emitted
	 * as a 'messages.upsert' event.
	 * @example
	 * ```ts
	 * ctx.drop = true // silently ignore this message
	 * ```
	 */
	drop: boolean
	/**
	 * Arbitrary metadata bag. Plugins and middleware can attach data here
	 * to share context without coupling.
	 */
	readonly meta: Record<string, unknown>
}

// ─── Outgoing Message Context ─────────────────────────────────────────────────

/** Context passed to every outgoing message middleware */
export interface OutgoingMessageContext {
	/** The destination JID */
	readonly jid: string
	/** The message content being sent */
	content: AnyMessageContent
	/** Message send options */
	options?: MiscMessageGenerationOptions
	/**
	 * Set to true in middleware to abort the send.
	 * The sendMessage call will resolve with null.
	 */
	abort: boolean
	/**
	 * Arbitrary metadata bag for sharing context across middleware.
	 */
	readonly meta: Record<string, unknown>
}
