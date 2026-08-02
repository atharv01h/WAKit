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
 * A composed middleware pipeline. Use `.use()` to add middleware
 * and `.execute()` to run the pipeline against a context.
 */
export interface MiddlewarePipeline<TContext> {
	/** Add a middleware to the end of the pipeline */
	use(middleware: Middleware<TContext>): void
	/**
	 * Execute all middleware in registration order against the given context.
	 * If no middleware is registered, this is a zero-overhead no-op.
	 */
	execute(ctx: TContext): Promise<void>
	/** Whether any middleware has been registered */
	readonly hasMiddleware: boolean
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
