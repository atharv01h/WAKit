import { dedupMiddleware, filterJidMiddleware, rateLimitMiddleware } from '../../Middleware/builtins'
import { createPipeline } from '../../Middleware/createPipeline'
import type { IncomingMessageContext } from '../../Middleware/types'

function makeCtx(id = 'msg-1', jid = 'user@s.whatsapp.net'): IncomingMessageContext {
	return {
		message: { key: { id, remoteJid: jid, fromMe: false } },
		remoteJid: jid,
		drop: false,
		meta: {}
	}
}

describe('dedupMiddleware', () => {
	it('passes the first message through', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(dedupMiddleware())
		const ctx = makeCtx('unique-id')
		await pipeline.execute(ctx)
		expect(ctx.drop).toBe(false)
	})

	it('drops a duplicate message ID', async () => {
		const mw = dedupMiddleware()
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(mw)

		const first = makeCtx('dup-id')
		await pipeline.execute(first)
		expect(first.drop).toBe(false)

		const second = makeCtx('dup-id')
		await pipeline.execute(second)
		expect(second.drop).toBe(true)
	})

	it('allows different message IDs', async () => {
		const mw = dedupMiddleware()
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(mw)

		const a = makeCtx('id-A')
		const b = makeCtx('id-B')
		await pipeline.execute(a)
		await pipeline.execute(b)

		expect(a.drop).toBe(false)
		expect(b.drop).toBe(false)
	})

	it('passes through messages with no ID', async () => {
		const mw = dedupMiddleware()
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(mw)

		const ctx: IncomingMessageContext = {
			message: { key: { remoteJid: 'jid@s.whatsapp.net', fromMe: false } },
			remoteJid: 'jid@s.whatsapp.net',
			drop: false,
			meta: {}
		}
		await pipeline.execute(ctx)
		expect(ctx.drop).toBe(false)
	})
})

describe('filterJidMiddleware', () => {
	it('drops messages matching the predicate', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(filterJidMiddleware(jid => jid.endsWith('@broadcast')))

		const ctx = makeCtx('m1', 'status@broadcast')
		await pipeline.execute(ctx)
		expect(ctx.drop).toBe(true)
	})

	it('passes messages that do not match the predicate', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(filterJidMiddleware(jid => jid.endsWith('@broadcast')))

		const ctx = makeCtx('m1', 'user@s.whatsapp.net')
		await pipeline.execute(ctx)
		expect(ctx.drop).toBe(false)
	})
})

describe('rateLimitMiddleware', () => {
	it('allows messages under the limit', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(rateLimitMiddleware({ maxPerWindow: 5, windowMs: 60_000 }))

		for (let i = 0; i < 5; i++) {
			const ctx = makeCtx(`msg-${i}`)
			await pipeline.execute(ctx)
			expect(ctx.drop).toBe(false)
		}
	})

	it('drops messages exceeding the limit', async () => {
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(rateLimitMiddleware({ maxPerWindow: 2, windowMs: 60_000 }))

		const jid = 'spammer@s.whatsapp.net'
		for (let i = 0; i < 2; i++) {
			await pipeline.execute(makeCtx(`msg-${i}`, jid))
		}

		const over = makeCtx('over', jid)
		await pipeline.execute(over)
		expect(over.drop).toBe(true)
	})

	it('calls onLimitExceeded when provided', async () => {
		const exceeded: IncomingMessageContext[] = []
		const pipeline = createPipeline<IncomingMessageContext>()
		pipeline.use(
			rateLimitMiddleware({
				maxPerWindow: 1,
				windowMs: 60_000,
				onLimitExceeded: ctx => exceeded.push(ctx)
			})
		)

		const jid = 'spammer@s.whatsapp.net'
		await pipeline.execute(makeCtx('first', jid))
		await pipeline.execute(makeCtx('second', jid))

		expect(exceeded).toHaveLength(1)
	})
})
