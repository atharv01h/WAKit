import { createPipeline } from '../../Middleware/createPipeline'
import type { IncomingMessageContext } from '../../Middleware/types'

function makeCtx(jid = 'test@s.whatsapp.net'): IncomingMessageContext {
	return {
		message: { key: { id: 'test-id', remoteJid: jid, fromMe: false } },
		remoteJid: jid,
		drop: false,
		meta: {}
	}
}

describe('createPipeline — named middleware & enable/disable/remove', () => {
	it('returns an id when adding middleware', () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		const id = pipeline.use(async (_, next) => next())
		expect(typeof id).toBe('string')
		expect(id.length).toBeGreaterThan(0)
	})

	it('respects a caller-provided id', () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		const id = pipeline.use(async (_, next) => next(), 'my-id')
		expect(id).toBe('my-id')
	})

	it('disable() skips the middleware during execution', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		const called: number[] = []

		pipeline.use(async (_, next) => {
			called.push(1)
			await next()
		}, 'first')
		const id = pipeline.use(async (_, next) => {
			called.push(2)
			await next()
		}, 'second')
		pipeline.use(async (_, next) => {
			called.push(3)
			await next()
		}, 'third')

		pipeline.disable(id)
		await pipeline.execute(makeCtx())

		expect(called).toEqual([1, 3])
	})

	it('enable() re-enables a disabled middleware', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		const called: number[] = []

		const id = pipeline.use(async (_, next) => {
			called.push(1)
			await next()
		}, 'togglable')

		pipeline.disable(id)
		pipeline.enable(id)
		await pipeline.execute(makeCtx())

		expect(called).toEqual([1])
	})

	it('remove() eliminates the middleware permanently', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		const called: number[] = []

		pipeline.use(async (_, next) => {
			called.push(1)
			await next()
		}, 'first')
		const id = pipeline.use(async (_, next) => {
			called.push(2)
			await next()
		}, 'removable')

		const removed = pipeline.remove(id)
		expect(removed).toBe(true)

		await pipeline.execute(makeCtx())
		expect(called).toEqual([1])
	})

	it('remove() returns false for an unknown id', () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		expect(pipeline.remove('nonexistent')).toBe(false)
	})

	it('disable() returns false for an unknown id', () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		expect(pipeline.disable('nonexistent')).toBe(false)
	})

	it('hasMiddleware is false when all middleware are disabled', () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		const id = pipeline.use(async (_, next) => next())
		expect(pipeline.hasMiddleware).toBe(true)
		pipeline.disable(id)
		expect(pipeline.hasMiddleware).toBe(false)
	})

	it('entries() returns a snapshot of all middleware', () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(async (_, next) => next(), 'alpha')
		pipeline.use(async (_, next) => next(), 'beta')

		const snap = pipeline.entries()
		expect(snap).toHaveLength(2)
		expect(snap[0]?.id).toBe('alpha')
		expect(snap[1]?.id).toBe('beta')
		expect(snap[0]?.enabled).toBe(true)
	})

	it('entries() snapshot does not reflect live mutations', () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(async (_, next) => next(), 'alpha')
		const before = pipeline.entries()
		pipeline.use(async (_, next) => next(), 'beta')

		// Snapshot captured before 'beta' was added
		expect(before).toHaveLength(1)
	})
})

describe('createPipeline — error middleware', () => {
	it('calls useError() handler when middleware throws', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		const errors: unknown[] = []

		pipeline.useError(async (err, _ctx, next) => {
			errors.push(err)
			await next()
		})
		pipeline.use(async () => {
			throw new Error('boom')
		})

		await pipeline.execute(makeCtx())
		expect(errors).toHaveLength(1)
		expect((errors[0] as Error).message).toBe('boom')
	})

	it('re-throws if no error middleware is registered', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(async () => {
			throw new Error('unhandled')
		})

		await expect(pipeline.execute(makeCtx())).rejects.toThrow('unhandled')
	})

	it('executes error middleware in registration order', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		const order: number[] = []

		pipeline.useError(async (_, _ctx, next) => {
			order.push(1)
			await next()
		})
		pipeline.useError(async (_, _ctx, next) => {
			order.push(2)
			await next()
		})
		pipeline.use(async () => {
			throw new Error('err')
		})

		await pipeline.execute(makeCtx())
		expect(order).toEqual([1, 2])
	})
})

// ─── Original pipeline tests (regression) ────────────────────────────────────

describe('createPipeline — original behaviour (regression)', () => {
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

	it('short-circuits when next() is not called', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		const called: number[] = []

		pipeline.use(async ctx => {
			called.push(1)
			ctx.drop = true
		})
		pipeline.use(async (_, next) => {
			called.push(2)
			await next()
		})

		await pipeline.execute(makeCtx())
		expect(called).toEqual([1])
	})

	it('throws if next() is called multiple times', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(async (_, next) => {
			await next()
			await next()
		})

		await expect(pipeline.execute(makeCtx())).rejects.toThrow('next() was called multiple times')
	})
})
