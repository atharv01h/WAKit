import { createPipeline } from './createPipeline'
import type { Middleware, MiddlewarePipeline, IncomingMessageContext } from './types'

/**
 * Creates a group-scoped middleware pipeline that only processes messages
 * originating from a specific WhatsApp group JID.
 *
 * The returned pipeline can be added to the client's incoming pipeline via
 * `client.useIncoming(groupPipeline.asMiddleware())`.
 *
 * @example
 * ```ts
 * const support = createGroupPipeline('1234567890-group@g.us')
 * support.use(async (ctx, next) => {
 *   console.log('Support group message:', ctx.message.key.id)
 *   await next()
 * })
 * client.useIncoming(support.asMiddleware())
 * ```
 */
export interface GroupPipeline extends MiddlewarePipeline<IncomingMessageContext> {
	/** The group JID this pipeline is scoped to */
	readonly groupJid: string
	/**
	 * Returns this group pipeline as a standard middleware function
	 * that gates execution on `ctx.remoteJid === groupJid`.
	 */
	asMiddleware(): Middleware<IncomingMessageContext>
}

/**
 * Creates a pipeline scoped to messages from a specific group JID.
 *
 * @param groupJid The group JID to scope to (must end with `@g.us`).
 */
export function createGroupPipeline(groupJid: string): GroupPipeline {
	const inner = createPipeline<IncomingMessageContext>()

	const asMiddleware = (): Middleware<IncomingMessageContext> => {
		return async (ctx, next) => {
			if (ctx.remoteJid !== groupJid) {
				await next()
				return
			}

			// Run inner pipeline; if it completes without dropping, call outer next
			await inner.execute(ctx)
			if (!ctx.drop) {
				await next()
			}
		}
	}

	return {
		groupJid,
		asMiddleware,
		use: inner.use.bind(inner),
		useError: inner.useError.bind(inner),
		remove: inner.remove.bind(inner),
		disable: inner.disable.bind(inner),
		enable: inner.enable.bind(inner),
		execute: inner.execute.bind(inner),
		get hasMiddleware() {
			return inner.hasMiddleware
		},
		entries: inner.entries.bind(inner)
	}
}
