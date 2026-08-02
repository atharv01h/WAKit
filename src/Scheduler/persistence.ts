import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { PersistedJob } from './types'

/**
 * Saves persistent job definitions to a JSON file.
 * Only metadata is persisted (not the function reference).
 */
export async function saveJobs(path: string, jobs: PersistedJob[]): Promise<void> {
	const data = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), jobs }, null, 2)
	await writeFile(path, data, 'utf-8')
}

/**
 * Loads persisted job definitions from a JSON file.
 * Returns empty array if the file does not exist.
 */
export async function loadJobs(path: string): Promise<PersistedJob[]> {
	if (!existsSync(path)) return []

	const raw = await readFile(path, 'utf-8')
	const parsed: unknown = JSON.parse(raw)

	if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { jobs?: unknown }).jobs)) {
		throw new Error(`Scheduler persistence file at "${path}" is malformed.`)
	}

	return (parsed as { jobs: PersistedJob[] }).jobs
}
