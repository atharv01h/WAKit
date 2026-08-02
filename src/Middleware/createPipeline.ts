import type { Middleware, ErrorMiddleware, MiddlewarePipeline, NamedMiddlewareEntry } from './types'

let _idCounter = 0
function genId(): string {
	return `mw-${++_idCounter}`
}

/**
 * Creates a Koa-style composable middleware pipeline.
 *
 * Middleware runs in registration order. Each middleware receives the context
 * and a `next` function. Calling `next()` invokes the subsequent middleware.
 * Not calling `next()` short-circuits the pipeline.
 *
 * Supports:
 * - Named middleware with `id` for remove/enable/disable
 * - Error middleware via `useError()` — called when normal middleware throws
 * - O(1) counter-based dispatch (no recursion depth issues)
 *
 * @example
 * ```ts
 * const pipeline = createPipeline<IncomingMessageContext>()
 * pipeline.use(loggingMiddleware, 'logging')
 * pipeline.use(rateLimitMiddleware({ maxPerMinute: 60 }), 'rate-limit')
 * pipeline.disable('rate-limit')
 * await pipeline.execute(ctx)
 * ```
 */
export function createPipeline<TContext>(): MiddlewarePipeline<TContext> {
	const entries: NamedMiddlewareEntry<TContext>[] = []
	const errorMiddlewares: ErrorMiddleware<TContext>[] = []

	function use(middleware: Middleware<TContext>, id?: string): string {
		const resolvedId = id ?? genId()
		entries.push({ id: resolvedId, fn: middleware, enabled: true })
		return resolvedId
	}

	function useError(middleware: ErrorMiddleware<TContext>): void {
		errorMiddlewares.push(middleware)
	}

	function remove(id: string): boolean {
		const idx = entries.findIndex(e => e.id === id)
		if (idx === -1) return false
		entries.splice(idx, 1)
		return true
	}

	function disable(id: string): boolean {
		const entry = entries.find(e => e.id === id)
		if (!entry) return false
		entry.enabled = false
		return true
	}

	function enable(id: string): boolean {
		const entry = entries.find(e => e.id === id)
		if (!entry) return false
		entry.enabled = true
		return true
	}

	async function execute(ctx: TContext): Promise<void> {
		// Build active list each call — avoids stale index issues after remove/disable
		const active = entries.filter(e => e.enabled).map(e => e.fn)
		if (active.length === 0) return

		let index = -1

		const dispatch = async (i: number): Promise<void> => {
			if (i <= index) {
				throw new Error('next() was called multiple times within the same middleware')
			}

			index = i
			const fn = active[i]
			if (!fn) {
				// End of pipeline
				return
			}

			await fn(ctx, () => dispatch(i + 1))
		}

		try {
			await dispatch(0)
		} catch (err) {
			if (errorMiddlewares.length === 0) throw err

			// Run error middleware chain
			let errIndex = -1
			const dispatchError = async (j: number): Promise<void> => {
				if (j <= errIndex) {
					throw new Error('next() was called multiple times within the same error middleware')
				}
				errIndex = j
				const efn = errorMiddlewares[j]
				if (!efn) return
				await efn(err, ctx, () => dispatchError(j + 1))
			}

			await dispatchError(0)
		}
	}

	return {
		use,
		useError,
		remove,
		disable,
		enable,
		execute,
		get hasMiddleware(): boolean {
			return entries.some(e => e.enabled)
		},
		entries(): ReadonlyArray<Readonly<NamedMiddlewareEntry<TContext>>> {
			return entries.map(e => ({ ...e }))
		}
	}
}
