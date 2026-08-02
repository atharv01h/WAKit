import type { AnyMessageContent } from '../Types'

// ─── Job Types ────────────────────────────────────────────────────────────────

/** A job execution function. Receives the job ID for reference. */
export type JobFn = (jobId: string) => Promise<void> | void

/** Days of the week for weekly scheduling */
export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

/** Options for creating a scheduler job */
export interface JobOptions {
	/** Human-readable name for the job (for logging and diagnostics) */
	name?: string
	/**
	 * IANA timezone string for cron interpretation (default: local timezone).
	 * @example "Asia/Kolkata", "America/New_York", "Europe/London"
	 */
	timezone?: string
	/**
	 * Number of times to retry on failure (default: 0).
	 * Retries use an exponential backoff starting at `retryDelayMs`.
	 */
	maxRetries?: number
	/** Base delay in ms between retries (default: 1000) */
	retryDelayMs?: number
	/**
	 * Whether to persist the job across restarts.
	 * Persistent jobs are saved to disk and restored on loadState().
	 * Default: false.
	 */
	persistent?: boolean
}

/** The current status of a scheduled job */
export interface JobStatus {
	/** Unique job identifier */
	id: string
	/** Human-readable name */
	name: string
	/** The cron expression driving the job */
	cronExpression: string
	/** Whether the job is currently active */
	running: boolean
	/** Whether the job is paused */
	paused: boolean
	/** Whether the job is persistent */
	persistent: boolean
	/** IANA timezone */
	timezone?: string
	/** Number of successful executions */
	successCount: number
	/** Number of failed executions */
	failureCount: number
	/** Last execution time */
	lastRun?: Date
	/** Last error if the last run failed */
	lastError?: string
}

/** Configuration for WAKitScheduler */
export interface SchedulerConfig {
	/**
	 * Path to file for persisting job state (default: './wakit-jobs.json').
	 * Only jobs with `persistent: true` are saved here.
	 */
	persistencePath?: string
	/** Default timezone for all jobs (can be overridden per job) */
	defaultTimezone?: string
}

/** Persisted job data (serialized to disk) */
export interface PersistedJob {
	id: string
	name: string
	cronExpression: string
	timezone?: string
	persistent: true
	maxRetries: number
	retryDelayMs: number
	/** ISO string of when the job was created */
	createdAt: string
	/**
	 * For send-message jobs only: the JID and content.
	 * The fn is reconstructed on load from these fields.
	 */
	sendTarget?: {
		jid: string
		content: AnyMessageContent
	}
}
