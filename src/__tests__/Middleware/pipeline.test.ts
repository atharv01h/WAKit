import { createPipeline } from '../../Middleware/createPipeline'
import type { IncomingMessageContext } from '../../Middleware/types'
import type { WAMessage } from '../../Types'

function makeCtx(jid = 'test@s.whatsapp.net'): IncomingMessageContext {
	return {
		message: { key: { id: 'test-id', remoteJid: jid, fromMe: false } } as WAMessage,
		remoteJid: jid,
		drop: false,
		meta: {}
	}
}

describe('createPipeline', () => {
	it('executes middleware in registration order', async () => {
		const order: number[] = []
		const pipeline = createPipeline<IncomingMessageContext>()

		pipeline.use(async (_, next) => {
			order.push(1)
			await next()
			order.push(4)
		})
		pipeline.use(async (_, next) => {
			order.push(2)
			await next()
			order.push(3)
		})

		await pipeline.execute(makeCtx())
		expect(order).toEqual([1, 2, 3, 4])
	})

	it('passes context by reference', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(async (ctx, next) => {
			ctx.drop = true
			await next()
		})
		pipeline.use(async (ctx, next) => {
			expect(ctx.drop).toBe(true)
			await next()
		})

		const ctx = makeCtx()
		await pipeline.execute(ctx)
		expect(ctx.drop).toBe(true)
	})

	it('short-circuits when next() is not called', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		const called: number[] = []

		pipeline.use(async (ctx, _next) => {
			called.push(1)
			ctx.drop = true
			// intentionally not calling next
		})
		pipeline.use(async (_, next) => {
			called.push(2) // should NOT be reached
			await next()
		})

		await pipeline.execute(makeCtx())
		expect(called).toEqual([1])
	})

	it('is a no-op when no middleware is registered', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		expect(pipeline.hasMiddleware).toBe(false)
		// should not throw
		await expect(pipeline.execute(makeCtx())).resolves.toBeUndefined()
	})

	it('throws if next() is called multiple times', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(async (_, next) => {
			await next()
			await next() // second call — should throw
		})

		await expect(pipeline.execute(makeCtx())).rejects.toThrow('next() was called multiple times')
	})

	it('propagates errors from middleware', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(async () => {
			throw new Error('middleware-error')
		})

		await expect(pipeline.execute(makeCtx())).rejects.toThrow('middleware-error')
	})

	it('reflects hasMiddleware correctly', () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		expect(pipeline.hasMiddleware).toBe(false)
		pipeline.use(async (_, next) => next())
		expect(pipeline.hasMiddleware).toBe(true)
	})
})
