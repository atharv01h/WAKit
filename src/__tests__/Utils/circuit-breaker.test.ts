import { jest } from '@jest/globals'
import { CircuitBreaker, CircuitBreakerError } from '../../Utils/circuit-breaker'
import { Boom } from '@hapi/boom'

describe('CircuitBreaker', () => {
	let cb: CircuitBreaker

	beforeEach(() => {
		cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, successThreshold: 2, resetTimeoutMs: 50 })
	})

	afterEach(() => {
		cb.destroy()
	})

	it('starts in closed state', () => {
		expect(cb.state).toBe('closed')
		expect(cb.isOpen).toBe(false)
	})

	it('executes functions normally when closed', async () => {
		const result = await cb.exec(() => Promise.resolve(42))
		expect(result).toBe(42)
	})

	it('opens after failureThreshold consecutive failures', async () => {
		const fn = () => Promise.reject(new Error('fail'))

		for (let i = 0; i < 3; i++) {
			await expect(cb.exec(fn)).rejects.toThrow('fail')
		}

		expect(cb.state).toBe('open')
	})

	it('emits open event when transitioning to open', async () => {
		const onOpen = jest.fn()
		cb.on('open', onOpen)

		const fn = () => Promise.reject(new Error('fail'))
		for (let i = 0; i < 3; i++) {
			await expect(cb.exec(fn)).rejects.toThrow()
		}

		expect(onOpen).toHaveBeenCalledWith({ failures: 3 })
	})

	it('rejects immediately (503) when open', async () => {
		// Open the circuit
		const fn = () => Promise.reject(new Error('fail'))
		for (let i = 0; i < 3; i++) {
			await expect(cb.exec(fn)).rejects.toThrow()
		}

		// Should reject with 503
		await expect(cb.exec(() => Promise.resolve('ok'))).rejects.toMatchObject({
			output: { statusCode: 503 }
		})
	})

	it('transitions to half-open after resetTimeoutMs', async () => {
		const fn = () => Promise.reject(new Error('fail'))
		for (let i = 0; i < 3; i++) {
			await expect(cb.exec(fn)).rejects.toThrow()
		}

		expect(cb.state).toBe('open')
		await new Promise(r => setTimeout(r, 60))
		expect(cb.state).toBe('half-open')
	})

	it('closes after successThreshold successes in half-open', async () => {
		const fail = () => Promise.reject(new Error('fail'))
		for (let i = 0; i < 3; i++) {
			await expect(cb.exec(fail)).rejects.toThrow()
		}

		await new Promise(r => setTimeout(r, 60)) // → half-open

		await cb.exec(() => Promise.resolve('ok'))
		expect(cb.state).toBe('half-open') // 1 success, need 2

		await cb.exec(() => Promise.resolve('ok'))
		expect(cb.state).toBe('closed')
	})

	it('reopens if test call fails in half-open', async () => {
		const fail = () => Promise.reject(new Error('fail'))
		for (let i = 0; i < 3; i++) {
			await expect(cb.exec(fail)).rejects.toThrow()
		}

		await new Promise(r => setTimeout(r, 60)) // → half-open
		await expect(cb.exec(fail)).rejects.toThrow()
		expect(cb.state).toBe('open')
	})

	it('reset() returns circuit to closed state', async () => {
		const fn = () => Promise.reject(new Error('fail'))
		for (let i = 0; i < 3; i++) {
			await expect(cb.exec(fn)).rejects.toThrow()
		}

		expect(cb.state).toBe('open')
		cb.reset()
		expect(cb.state).toBe('closed')
	})

	it('emits rejected event when call is rejected while open', async () => {
		const onRejected = jest.fn()
		cb.on('rejected', onRejected)

		const fn = () => Promise.reject(new Error('fail'))
		for (let i = 0; i < 3; i++) {
			await expect(cb.exec(fn)).rejects.toThrow()
		}

		await expect(cb.exec(() => Promise.resolve('ok'))).rejects.toThrow()
		expect(onRejected).toHaveBeenCalledWith({ name: 'test' })
	})

	it('resets failure count on success in closed state', async () => {
		const fail = () => Promise.reject(new Error('fail'))
		await expect(cb.exec(fail)).rejects.toThrow()
		await expect(cb.exec(fail)).rejects.toThrow()
		// 2 failures — below threshold

		await cb.exec(() => Promise.resolve('ok')) // success resets counter

		await expect(cb.exec(fail)).rejects.toThrow()
		await expect(cb.exec(fail)).rejects.toThrow()
		// Now at 2 again, but previous was reset — circuit should NOT open yet
		expect(cb.state).toBe('closed')
	})
})
