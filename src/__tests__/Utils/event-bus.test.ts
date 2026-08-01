import EventEmitter from 'events'
import { wrapEventBus } from '../../Utils/event-bus'
import type { WAKitEventEmitter, WAKitEventMap } from '../../Types'

/** Create a minimal WAKitEventEmitter-compatible mock */
function makeBaseEmitter(): WAKitEventEmitter {
	const ee = new EventEmitter()
	return {
		on: ee.on.bind(ee),
		off: ee.off.bind(ee),
		removeAllListeners: ee.removeAllListeners.bind(ee),
		emit: (event: keyof WAKitEventMap, data: WAKitEventMap[keyof WAKitEventMap]) =>
			ee.emit(event as string, data)
	}
}

const SAMPLE_MSG = { key: { id: 'msg-1', remoteJid: 'abc@s.whatsapp.net', fromMe: false } }

describe('wrapEventBus', () => {
	it('proxies on/off/emit to the underlying emitter', () => {
		const base = makeBaseEmitter()
		const bus = wrapEventBus(base)
		const received: unknown[] = []

		bus.on('connection.update', data => received.push(data))
		bus.emit('connection.update', { connection: 'open' })

		expect(received).toHaveLength(1)
		expect((received[0] as { connection: string }).connection).toBe('open')
	})

	it('records history for emitted events', () => {
		const bus = wrapEventBus(makeBaseEmitter(), { historyCapacity: 10 })
		bus.emit('connection.update', { connection: 'open' })
		bus.emit('connection.update', { connection: 'close' })

		const hist = bus.history('connection.update')
		expect(hist).toHaveLength(2)
		expect(hist[0]!.data.connection).toBe('open')
		expect(hist[1]!.data.connection).toBe('close')
	})

	it('replay() calls listener for all buffered events', () => {
		const bus = wrapEventBus(makeBaseEmitter())
		bus.emit('connection.update', { connection: 'open' })
		bus.emit('connection.update', { connection: 'close' })

		const replayed: string[] = []
		bus.replay('connection.update', ({ connection }) => {
			if (connection) replayed.push(connection)
		})

		expect(replayed).toEqual(['open', 'close'])
	})

	it('replay() respects the since filter', async () => {
		const bus = wrapEventBus(makeBaseEmitter())
		const before = new Date()
		await new Promise(r => setTimeout(r, 5))

		bus.emit('connection.update', { connection: 'open' })

		const replayed: string[] = []
		bus.replay('connection.update', ({ connection }) => {
			if (connection) replayed.push(connection)
		}, before)

		expect(replayed).toEqual(['open'])

		// With a cutoff in the future — nothing should be replayed
		const future = new Date(Date.now() + 60_000)
		const replayedFuture: string[] = []
		bus.replay('connection.update', ({ connection }) => {
			if (connection) replayedFuture.push(connection as string)
		}, future)
		expect(replayedFuture).toHaveLength(0)
	})

	it('ring buffer caps at historyCapacity', () => {
		const bus = wrapEventBus(makeBaseEmitter(), { historyCapacity: 3 })
		for (let i = 0; i < 5; i++) {
			bus.emit('connection.update', { connection: `event-${i}` as 'open' | 'close' | 'connecting' })
		}

		const hist = bus.history('connection.update')
		expect(hist).toHaveLength(3)
		// Should have oldest entries evicted
		expect(hist[0]!.data.connection).toBe('event-2' as 'open' | 'close' | 'connecting')
	})

	it('filter() only calls listener when predicate returns true', () => {
		const bus = wrapEventBus(makeBaseEmitter())
		const received: string[] = []

		bus.filter(
			'connection.update',
			({ connection }) => connection === 'open',
			({ connection }) => received.push(connection as string)
		)

		bus.emit('connection.update', { connection: 'open' })
		bus.emit('connection.update', { connection: 'close' })
		bus.emit('connection.update', { connection: 'open' })

		expect(received).toEqual(['open', 'open'])
	})

	it('filter() returns an unsubscribe function', () => {
		const bus = wrapEventBus(makeBaseEmitter())
		const received: unknown[] = []

		const unsub = bus.filter(
			'connection.update',
			() => true,
			data => received.push(data)
		)

		bus.emit('connection.update', { connection: 'open' })
		unsub()
		bus.emit('connection.update', { connection: 'open' })

		expect(received).toHaveLength(1)
	})

	it('record() captures all events after it is called', () => {
		const bus = wrapEventBus(makeBaseEmitter())
		bus.emit('connection.update', { connection: 'open' }) // before recording

		const stop = bus.record()
		bus.emit('connection.update', { connection: 'close' })
		bus.emit('connection.update', { connection: 'connecting' })
		const captured = stop()

		// Only events after record() was called
		expect(captured).toHaveLength(2)
		expect(captured[0]!.event).toBe('connection.update')
		expect((captured[0]!.data as { connection?: string }).connection).toBe('close')
	})

	it('record() stops capturing after stop() is called', () => {
		const bus = wrapEventBus(makeBaseEmitter())
		const stop = bus.record()
		bus.emit('connection.update', { connection: 'open' })
		const captured = stop()
		bus.emit('connection.update', { connection: 'close' }) // after stop

		expect(captured).toHaveLength(1)
	})

	it('history() returns empty array for events not yet emitted', () => {
		const bus = wrapEventBus(makeBaseEmitter())
		expect(bus.history('creds.update')).toEqual([])
	})
})
