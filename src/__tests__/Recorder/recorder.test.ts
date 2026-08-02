import { WAKitRecorder } from '../../Recorder/WAKitRecorder'
import type { WAKitEventMap } from '../../Types'

type ListenerMap = Map<string, Array<(data: unknown) => void>>

function makeRecorderWithEmitter() {
	const recorder = new WAKitRecorder()
	const listenerMap: ListenerMap = new Map()
	let emitHistory: Array<{ event: string; data: unknown }> = []

	const onFn = (event: keyof WAKitEventMap, listener: (data: WAKitEventMap[keyof WAKitEventMap]) => void) => {
		if (!listenerMap.has(event)) listenerMap.set(event, [])
		listenerMap.get(event)!.push(listener as (d: unknown) => void)
	}

	const offFn = (event: keyof WAKitEventMap, listener: (data: WAKitEventMap[keyof WAKitEventMap]) => void) => {
		const listeners = listenerMap.get(event) ?? []
		const idx = listeners.indexOf(listener as (d: unknown) => void)
		if (idx !== -1) listeners.splice(idx, 1)
	}

	const emitFn = (event: keyof WAKitEventMap, data: WAKitEventMap[keyof WAKitEventMap]) => {
		emitHistory.push({ event, data })
		const listeners = listenerMap.get(event) ?? []
		for (const l of listeners) l(data)
	}

	recorder._wire(onFn, offFn, emitFn)

	// Helper to simulate an event being fired
	const fire = (event: keyof WAKitEventMap, data: WAKitEventMap[keyof WAKitEventMap]) => {
		const listeners = listenerMap.get(event) ?? []
		for (const l of listeners) l(data)
	}

	return { recorder, fire, emitHistory }
}

describe('WAKitRecorder — recording', () => {
	it('isRecording is false initially', () => {
		const { recorder } = makeRecorderWithEmitter()
		expect(recorder.isRecording).toBe(false)
	})

	it('start() begins recording', () => {
		const { recorder } = makeRecorderWithEmitter()
		recorder.start()
		expect(recorder.isRecording).toBe(true)
	})

	it('stop() returns a RecordedSession and clears state', () => {
		const { recorder, fire } = makeRecorderWithEmitter()
		recorder.start()

		fire('connection.update', { connection: 'open' })
		const session = recorder.stop()

		expect(recorder.isRecording).toBe(false)
		expect(session.version).toBe(1)
		expect(session.events.length).toBeGreaterThan(0)
		expect(session.events[0]?.event).toBe('connection.update')
	})

	it('eventCount reflects captured events', () => {
		const { recorder, fire } = makeRecorderWithEmitter()
		recorder.start()

		fire('connection.update', {})
		fire('connection.update', {})
		expect(recorder.eventCount).toBe(2)
	})

	it('stop() throws if not recording', () => {
		const { recorder } = makeRecorderWithEmitter()
		expect(() => recorder.stop()).toThrow('not currently recording')
	})

	it('start() is idempotent when called twice', () => {
		const { recorder, fire } = makeRecorderWithEmitter()
		recorder.start()
		recorder.start() // no-op
		fire('connection.update', {})
		const session = recorder.stop()
		expect(session.events).toHaveLength(1)
	})
})

describe('WAKitRecorder — replay', () => {
	it('emits recorded events during replay', async () => {
		const { recorder, fire } = makeRecorderWithEmitter()
		recorder.start()
		fire('connection.update', { connection: 'open' })
		fire('connection.update', { connection: 'close' })
		const session = recorder.stop()

		const { recorder: replayRecorder, emitHistory } = makeRecorderWithEmitter()

		// Use a second recorder to capture replayed events
		await replayRecorder.replay(session, { speed: 0 })
		expect(emitHistory.length).toBe(2)
	})

	it('filter option only replays matching event types', async () => {
		const { recorder, fire } = makeRecorderWithEmitter()
		recorder.start()
		fire('connection.update', {})
		fire('creds.update', {})
		fire('connection.update', {})
		const session = recorder.stop()

		const { emitHistory } = makeRecorderWithEmitter()
		const replayer = new WAKitRecorder()
		replayer._wire(
			() => {},
			() => {},
			(event, data) => emitHistory.push({ event, data })
		)

		await replayer.replay(session, { speed: 0, filter: ['connection.update'] })
		expect(emitHistory.every(e => e.event === 'connection.update')).toBe(true)
		expect(emitHistory).toHaveLength(2)
	})

	it('fromIndex and toIndex slice the event range', async () => {
		const { recorder, fire } = makeRecorderWithEmitter()
		recorder.start()
		for (let i = 0; i < 5; i++) fire('connection.update', { connection: 'open' })
		const session = recorder.stop()

		const emitHistory: unknown[] = []
		const replayer = new WAKitRecorder()
		replayer._wire(
			() => {},
			() => {},
			() => {
				emitHistory.push(1)
			}
		)

		await replayer.replay(session, { speed: 0, fromIndex: 1, toIndex: 3 })
		expect(emitHistory).toHaveLength(3) // indices 1, 2, 3
	})

	it('onEvent callback fires for each event', async () => {
		const { recorder, fire } = makeRecorderWithEmitter()
		recorder.start()
		fire('connection.update', {})
		fire('creds.update', {})
		const session = recorder.stop()

		const seen: number[] = []
		const replayer = new WAKitRecorder()
		replayer._wire(
			() => {},
			() => {},
			() => {}
		)

		await replayer.replay(session, {
			speed: 0,
			onEvent: (_entry, idx) => seen.push(idx)
		})

		expect(seen).toEqual([0, 1])
	})

	it('throws on malformed file', async () => {
		const { recorder } = makeRecorderWithEmitter()
		await expect(recorder.load('./nonexistent-file-xyz.json')).rejects.toThrow('not found')
	})
})
