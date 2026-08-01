import type { Middleware, MiddlewarePipeline } from './types'

/**
 * Creates a Koa-style composable middleware pipeline.
 *
 * Middleware runs in registration order. Each middleware receives the context
 * and a `next` function. Calling `next()` invokes the subsequent middleware.
 * Not calling `next()` short-circuits the pipeline.
 *
 * This compose implementation is O(1) — it does not recurse; it uses a
 * plain index counter, which is safer for deeply stacked pipelines.
 *
 * @example
 * ```ts
 * const pipeline = createPipeline<IncomingMessageContext>()
 * pipeline.use(loggingMiddleware)
 * pipeline.use(rateLimitMiddleware({ maxPerMinute: 60 }))
 * await pipeline.execute(ctx)
 * ```
 */
export function createPipeline<TContext>(): MiddlewarePipeline<TContext> {
	const middlewares: Middleware<TContext>[] = []

	return {
		use(middleware: Middleware<TContext>): void {
			middlewares.push(middleware)
		},

		get hasMiddleware(): boolean {
			return middlewares.length > 0
		},

		async execute(ctx: TContext): Promise<void> {
			if (middlewares.length === 0) {
				// Fast path: no middleware registered
				return
			}

			let index = -1

			const dispatch = async (i: number): Promise<void> => {
				if (i <= index) {
					throw new Error('next() was called multiple times within the same middleware')
				}

				index = i
				const fn = middlewares[i]
				if (!fn) {
					// End of pipeline
					return
				}

				await fn(ctx, () => dispatch(i + 1))
			}

			await dispatch(0)
		}
	}
}
