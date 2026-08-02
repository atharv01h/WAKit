import { WAKitScheduler } from '../../Scheduler/WAKitScheduler'

describe('WAKitScheduler — job registration', () => {
	let scheduler: WAKitScheduler

	beforeEach(() => {
		scheduler = new WAKitScheduler()
		scheduler.start()
	})

	afterEach(() => {
		scheduler.stop()
	})

	it('everyMinute() registers a job and returns a job ID', () => {
		const id = scheduler.everyMinute(async () => {})
		expect(typeof id).toBe('string')
		expect(id.length).toBeGreaterThan(0)
	})

	it('everyHour() registers a job', () => {
		const id = scheduler.everyHour(async () => {})
		const status = scheduler.get(id)
		expect(status?.cronExpression).toBe('0 * * * *')
	})

	it('daily() registers a job with correct cron expression', () => {
		const id = scheduler.daily('09:30', async () => {})
		const status = scheduler.get(id)
		expect(status?.cronExpression).toBe('30 9 * * *')
	})

	it('daily() throws for invalid time format', () => {
		expect(() => scheduler.daily('25:00', async () => {})).toThrow('Invalid time format')
		expect(() => scheduler.daily('09:60', async () => {})).toThrow('Invalid time format')
		expect(() => scheduler.daily('not-a-time', async () => {})).toThrow('Invalid time format')
	})

	it('weekly() registers a job on the correct day', () => {
		const id = scheduler.weekly('monday', '08:00', async () => {})
		const status = scheduler.get(id)
		expect(status?.cronExpression).toBe('0 8 * * 1')
	})

	it('monthly() registers a job on the correct day of month', () => {
		const id = scheduler.monthly(15, '12:00', async () => {})
		const status = scheduler.get(id)
		expect(status?.cronExpression).toBe('0 12 15 * *')
	})

	it('monthly() throws for invalid day', () => {
		expect(() => scheduler.monthly(0, '12:00', async () => {})).toThrow('Invalid dayOfMonth')
		expect(() => scheduler.monthly(32, '12:00', async () => {})).toThrow('Invalid dayOfMonth')
	})

	it('cron() validates the expression', () => {
		expect(() => scheduler.cron('not a cron', async () => {})).toThrow('Invalid cron expression')
	})

	it('cron() registers a valid expression', () => {
		const id = scheduler.cron('*/5 * * * *', async () => {})
		expect(scheduler.get(id)).toBeDefined()
	})

	it('named jobs appear in list() with their name', () => {
		scheduler.everyMinute(async () => {}, { name: 'my-heartbeat' })
		const jobs = scheduler.list()
		expect(jobs.some(j => j.name === 'my-heartbeat')).toBe(true)
	})
})

describe('WAKitScheduler — job lifecycle', () => {
	let scheduler: WAKitScheduler

	beforeEach(() => {
		scheduler = new WAKitScheduler()
		scheduler.start()
	})

	afterEach(() => {
		scheduler.stop()
	})

	it('pause() marks the job as paused', () => {
		const id = scheduler.everyMinute(async () => {})
		scheduler.pause(id)
		expect(scheduler.get(id)?.paused).toBe(true)
		expect(scheduler.get(id)?.running).toBe(false)
	})

	it('resume() un-pauses the job', () => {
		const id = scheduler.everyMinute(async () => {})
		scheduler.pause(id)
		scheduler.resume(id)
		expect(scheduler.get(id)?.paused).toBe(false)
		expect(scheduler.get(id)?.running).toBe(true)
	})

	it('cancel() removes the job from the registry', () => {
		const id = scheduler.everyMinute(async () => {})
		scheduler.cancel(id)
		expect(scheduler.get(id)).toBeUndefined()
	})

	it('cancel() is idempotent for unknown jobs', () => {
		expect(() => scheduler.cancel('ghost-id')).not.toThrow()
	})

	it('pause() throws for unknown job', () => {
		expect(() => scheduler.pause('ghost')).toThrow('"ghost" not found')
	})

	it('list() returns all registered jobs', () => {
		scheduler.everyMinute(async () => {})
		scheduler.everyHour(async () => {})
		expect(scheduler.list()).toHaveLength(2)
	})

	it('get() returns undefined for unknown job', () => {
		expect(scheduler.get('nope')).toBeUndefined()
	})
})

describe('WAKitScheduler — send()', () => {
	let scheduler: WAKitScheduler

	beforeEach(() => {
		scheduler = new WAKitScheduler()
		scheduler.start()
	})

	afterEach(() => {
		scheduler.stop()
	})

	it('throws when scheduling for the past', () => {
		const past = new Date(Date.now() - 1000)
		expect(() => scheduler.send('jid@s.whatsapp.net', { text: 'hi' }, past)).toThrow('must be in the future')
	})

	it('registers a job for a future date', () => {
		const future = new Date(Date.now() + 60_000 * 60 * 24) // tomorrow
		const id = scheduler.send('jid@s.whatsapp.net', { text: 'reminder' }, future)
		expect(typeof id).toBe('string')
		expect(scheduler.get(id)).toBeDefined()
	})
})
