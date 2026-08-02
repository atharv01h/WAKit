import { Boom } from '@hapi/boom'
import cron from 'node-cron'
import type { AnyMessageContent } from '../Types'
import type { JobFn, JobOptions, JobStatus, SchedulerConfig, DayOfWeek, PersistedJob } from './types'
import { saveJobs, loadJobs } from './persistence'

const DAY_MAP: Record<DayOfWeek, number> = {
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6
}

interface JobEntry {
	id: string
	name: string
	cronExpression: string
	task: ReturnType<typeof cron.schedule>
	fn: JobFn
	paused: boolean
	persistent: boolean
	timezone?: string
	maxRetries: number
	retryDelayMs: number
	successCount: number
	failureCount: number
	lastRun?: Date
	lastError?: string
	sendTarget?: PersistedJob['sendTarget']
}

let _idCounter = 0
function genJobId(): string {
	return `job-${Date.now()}-${++_idCounter}`
}

/**
 * WAKitScheduler provides a powerful job scheduling system backed by node-cron.
 *
 * Features:
 * - Fluent API: everyMinute, everyHour, daily, weekly, monthly, cron
 * - Message scheduling: client.scheduler.send(jid, content, at)
 * - Job lifecycle: pause, resume, cancel
 * - Introspection: list(), get()
 * - Persistence: persistent jobs survive process restarts
 * - Per-job error recovery with retry
 *
 * @example
 * ```ts
 * const client = await createClient({ auth: './session' })
 *
 * // Run every minute
 * client.scheduler.everyMinute(async () => console.log('tick'), { name: 'heartbeat' })
 *
 * // Daily at 9am IST
 * client.scheduler.daily('09:00', async () => {
 *   await client.sendMessage('jid@s.whatsapp.net', { text: 'Good morning!' })
 * }, { timezone: 'Asia/Kolkata' })
 *
 * // Schedule a message for a specific time
 * const tomorrow9AM = new Date(Date.now() + 86_400_000)
 * tomorrow9AM.setHours(9, 0, 0, 0)
 * client.scheduler.send('jid@s.whatsapp.net', { text: 'Reminder!' }, tomorrow9AM)
 * ```
 */
export class WAKitScheduler {
	private readonly _jobs = new Map<string, JobEntry>()
	private readonly _config: Required<SchedulerConfig>
	private _started = false
	private _sendMessageFn: ((jid: string, content: AnyMessageContent) => Promise<unknown>) | null = null

	constructor(config: SchedulerConfig = {}) {
		this._config = {
			persistencePath: config.persistencePath ?? './wakit-jobs.json',
			defaultTimezone: config.defaultTimezone ?? ''
		}
	}

	/**
	 * @internal Called by WAKitClient after the socket is available.
	 * Injects the sendMessage function so scheduled sends can work.
	 */
	_setSendMessage(fn: (jid: string, content: AnyMessageContent) => Promise<unknown>): void {
		this._sendMessageFn = fn
	}

	/** Start the scheduler (begins executing jobs). Called automatically by WAKitClient. */
	start(): void {
		this._started = true
	}

	/** Stop all jobs and clean up. */
	stop(): void {
		for (const entry of this._jobs.values()) {
			entry.task.stop()
		}

		this._jobs.clear()
		this._started = false
	}

	// ─── Fluent scheduling API ────────────────────────────────────────────────

	/**
	 * Schedule a job to run every minute.
	 * @returns The assigned job ID.
	 */
	everyMinute(fn: JobFn, opts: JobOptions = {}): string {
		return this._schedule('* * * * *', fn, opts)
	}

	/**
	 * Schedule a job to run every hour (at minute 0).
	 * @returns The assigned job ID.
	 */
	everyHour(fn: JobFn, opts: JobOptions = {}): string {
		return this._schedule('0 * * * *', fn, opts)
	}

	/**
	 * Schedule a job to run daily at the specified time.
	 * @param time Time string in "HH:MM" format (24h).
	 * @returns The assigned job ID.
	 *
	 * @example
	 * ```ts
	 * scheduler.daily('09:00', sendMorningReport)
	 * ```
	 */
	daily(time: string, fn: JobFn, opts: JobOptions = {}): string {
		const [hours, minutes] = time.split(':').map(Number)
		if (
			hours === undefined ||
			minutes === undefined ||
			isNaN(hours) ||
			isNaN(minutes) ||
			hours < 0 ||
			hours > 23 ||
			minutes < 0 ||
			minutes > 59
		) {
			throw new Boom(`Invalid time format "${time}". Expected "HH:MM" (24-hour).`, { statusCode: 400 })
		}

		return this._schedule(`${minutes} ${hours} * * *`, fn, opts)
	}

	/**
	 * Schedule a job to run weekly on the specified day and time.
	 * @param day Day of week (e.g. 'monday')
	 * @param time Time in "HH:MM" format.
	 * @returns The assigned job ID.
	 */
	weekly(day: DayOfWeek, time: string, fn: JobFn, opts: JobOptions = {}): string {
		const [hours, minutes] = time.split(':').map(Number)
		if (hours === undefined || minutes === undefined || isNaN(hours) || isNaN(minutes)) {
			throw new Boom(`Invalid time format "${time}". Expected "HH:MM" (24-hour).`, { statusCode: 400 })
		}

		const dow = DAY_MAP[day]
		return this._schedule(`${minutes} ${hours} * * ${dow}`, fn, opts)
	}

	/**
	 * Schedule a job to run monthly on the specified day of the month and time.
	 * @param dayOfMonth Day number (1–28 safe for all months).
	 * @param time Time in "HH:MM" format.
	 * @returns The assigned job ID.
	 */
	monthly(dayOfMonth: number, time: string, fn: JobFn, opts: JobOptions = {}): string {
		if (dayOfMonth < 1 || dayOfMonth > 31) {
			throw new Boom(`Invalid dayOfMonth ${dayOfMonth}. Must be 1–31.`, { statusCode: 400 })
		}

		const [hours, minutes] = time.split(':').map(Number)
		if (hours === undefined || minutes === undefined || isNaN(hours) || isNaN(minutes)) {
			throw new Boom(`Invalid time format "${time}". Expected "HH:MM" (24-hour).`, { statusCode: 400 })
		}

		return this._schedule(`${minutes} ${hours} ${dayOfMonth} * *`, fn, opts)
	}

	/**
	 * Schedule a job using a raw cron expression.
	 * @param expression Standard 5-field cron expression.
	 * @returns The assigned job ID.
	 *
	 * @example
	 * ```ts
	 * scheduler.cron('0 9 * * MON-FRI', sendWeekdayReport)
	 * ```
	 */
	cron(expression: string, fn: JobFn, opts: JobOptions = {}): string {
		if (!cron.validate(expression)) {
			throw new Boom(`Invalid cron expression: "${expression}".`, { statusCode: 400 })
		}

		return this._schedule(expression, fn, opts)
	}

	/**
	 * Schedule a WhatsApp message to be sent at a specific Date.
	 *
	 * Uses a one-shot cron job that auto-cancels after firing.
	 *
	 * @param jid Destination JID
	 * @param content Message content
	 * @param at Date to send the message
	 * @returns The assigned job ID
	 *
	 * @example
	 * ```ts
	 * const tomorrow = new Date(Date.now() + 86_400_000)
	 * scheduler.send('123@s.whatsapp.net', { text: 'Hello!' }, tomorrow)
	 * ```
	 */
	send(jid: string, content: AnyMessageContent, at: Date, opts: JobOptions = {}): string {
		const now = Date.now()
		if (at.getTime() <= now) {
			throw new Boom(`Scheduled send time must be in the future. Got: ${at.toISOString()}`, {
				statusCode: 400
			})
		}

		const m = at.getMonth() + 1
		const d = at.getDate()
		const h = at.getHours()
		const min = at.getMinutes()
		// One-shot: specific date expression
		const expression = `${min} ${h} ${d} ${m} *`

		const jobId = this._schedule(
			expression,
			async id => {
				if (!this._sendMessageFn) {
					throw new Boom('Scheduler: sendMessage function not available. Is the client connected?', {
						statusCode: 503
					})
				}

				await this._sendMessageFn(jid, content)
				// Auto-cancel after first execution
				this.cancel(id)
			},
			{ ...opts, name: opts.name ?? `send:${jid}` }
		)

		// Store send target for persistence
		const entry = this._jobs.get(jobId)
		if (entry) {
			entry.sendTarget = { jid, content }
		}

		return jobId
	}

	// ─── Job lifecycle ────────────────────────────────────────────────────────

	/**
	 * Pause a running job. The job will not fire until resumed.
	 */
	pause(jobId: string): void {
		const entry = this._getOrThrow(jobId)
		entry.task.stop()
		entry.paused = true
	}

	/**
	 * Resume a paused job.
	 */
	resume(jobId: string): void {
		const entry = this._getOrThrow(jobId)
		entry.task.start()
		entry.paused = false
	}

	/**
	 * Cancel and remove a job permanently.
	 */
	cancel(jobId: string): void {
		const entry = this._jobs.get(jobId)
		if (!entry) return // idempotent
		entry.task.stop()
		this._jobs.delete(jobId)
	}

	// ─── Introspection ────────────────────────────────────────────────────────

	/** Returns status of all registered jobs */
	list(): JobStatus[] {
		return [...this._jobs.values()].map(e => this._toStatus(e))
	}

	/** Returns status of a single job, or undefined if not found */
	get(jobId: string): JobStatus | undefined {
		const entry = this._jobs.get(jobId)
		return entry ? this._toStatus(entry) : undefined
	}

	// ─── Persistence ─────────────────────────────────────────────────────────

	/** Persist all persistent jobs to disk */
	async saveState(): Promise<void> {
		const persistent: PersistedJob[] = [...this._jobs.values()]
			.filter(e => e.persistent)
			.map(e => ({
				id: e.id,
				name: e.name,
				cronExpression: e.cronExpression,
				timezone: e.timezone,
				persistent: true as const,
				maxRetries: e.maxRetries,
				retryDelayMs: e.retryDelayMs,
				createdAt: new Date().toISOString(),
				sendTarget: e.sendTarget
			}))

		await saveJobs(this._config.persistencePath, persistent)
	}

	/**
	 * Load and restore persistent jobs from disk.
	 * Send-message jobs are restored with a live sendMessage function.
	 * Custom function jobs cannot be restored (they require the function to be re-registered).
	 */
	async loadState(): Promise<void> {
		const jobs = await loadJobs(this._config.persistencePath)

		for (const job of jobs) {
			// Skip if already registered (e.g., double-call to loadState)
			if (this._jobs.has(job.id)) continue

			if (job.sendTarget) {
				// Restore send-message job
				this._schedule(
					job.cronExpression,
					async id => {
						if (!this._sendMessageFn) return
						await this._sendMessageFn(job.sendTarget!.jid, job.sendTarget!.content)
						this.cancel(id)
					},
					{
						name: job.name,
						timezone: job.timezone,
						maxRetries: job.maxRetries,
						retryDelayMs: job.retryDelayMs,
						persistent: true
					},
					job.id
				)
			}
			// Note: non-send persistent jobs must be re-registered by the application
		}
	}

	// ─── Private helpers ─────────────────────────────────────────────────────

	private _schedule(expression: string, fn: JobFn, opts: JobOptions, fixedId?: string): string {
		const id = fixedId ?? genJobId()
		const timezone = opts.timezone ?? (this._config.defaultTimezone || undefined)

		const task = cron.schedule(
			expression,
			async () => {
				const entry = this._jobs.get(id)
				if (!entry || entry.paused) return
				await this._executeWithRetry(entry)
			},
			{
				scheduled: true,
				timezone
			}
		)

		this._jobs.set(id, {
			id,
			name: opts.name ?? id,
			cronExpression: expression,
			task,
			fn,
			paused: false,
			persistent: opts.persistent ?? false,
			timezone,
			maxRetries: opts.maxRetries ?? 0,
			retryDelayMs: opts.retryDelayMs ?? 1000,
			successCount: 0,
			failureCount: 0
		})

		return id
	}

	private async _executeWithRetry(entry: JobEntry): Promise<void> {
		entry.lastRun = new Date()

		for (let attempt = 0; attempt <= entry.maxRetries; attempt++) {
			try {
				await entry.fn(entry.id)
				entry.successCount++
				entry.lastError = undefined
				return
			} catch (err) {
				entry.failureCount++
				entry.lastError = err instanceof Error ? err.message : String(err)

				if (attempt < entry.maxRetries) {
					await new Promise(r => setTimeout(r, entry.retryDelayMs * Math.pow(2, attempt)))
				}
			}
		}
	}

	private _getOrThrow(jobId: string): JobEntry {
		const entry = this._jobs.get(jobId)
		if (!entry) {
			throw new Boom(`Scheduler job "${jobId}" not found.`, { statusCode: 404 })
		}

		return entry
	}

	private _toStatus(e: JobEntry): JobStatus {
		return {
			id: e.id,
			name: e.name,
			cronExpression: e.cronExpression,
			running: !e.paused,
			paused: e.paused,
			persistent: e.persistent,
			timezone: e.timezone,
			successCount: e.successCount,
			failureCount: e.failureCount,
			lastRun: e.lastRun,
			lastError: e.lastError
		}
	}
}
