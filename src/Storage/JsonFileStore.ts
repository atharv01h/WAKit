import { mkdir, readFile, stat, writeFile, unlink } from 'fs/promises'
import { join, resolve } from 'path'
import { Mutex } from 'async-mutex'
import type { AuthenticationCreds, Chat, SignalDataSet, SignalDataTypeMap } from '../Types'
import { proto } from '../../WAProto/index.js'
import { BufferJSON } from '../Utils/generics'
import { initAuthCreds } from '../Utils/auth-utils'
import type { WAKitStore } from './types'

/**
 * File-system based WAKitStore.
 *
 * This is an improved replacement for useMultiFileAuthState with:
 * - Single `creds.json` (no more O(N) startup file reads)
 * - Per-file mutex locking (same safety as useMultiFileAuthState)
 * - Backward-compatible directory format — reads existing wakit_auth_info/ directories
 * - Batched writes with 50ms debounce to reduce I/O on history sync storms
 *
 * @example
 * ```ts
 * import { JsonFileStore } from 'wakit'
 *
 * const store = new JsonFileStore('./session')
 * const client = await createClient({ auth: store })
 * ```
 */
export class JsonFileStore implements WAKitStore {
	private readonly _folder: string
	private readonly _fileLocks = new Map<string, Mutex>()
	private _initialized = false

	// In-memory cache for signal data
	private _keysData: Record<string, Record<string, any>> | null = null
	private _flushTimer: ReturnType<typeof setTimeout> | null = null

	constructor(folder: string) {
		this._folder = resolve(folder)
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	async initialize(): Promise<void> {
		if (this._initialized) return
		const info = await stat(this._folder).catch(() => null)
		if (info) {
			if (!info.isDirectory()) {
				throw new Error(`JsonFileStore: path "${this._folder}" exists but is not a directory`)
			}
		} else {
			await mkdir(this._folder, { recursive: true })
		}

		// Load keys from keys.json if it exists
		if (this._keysData === null) {
			this._keysData = (await this._readJson<Record<string, Record<string, any>>>('keys.json')) ?? {}
		}

		this._initialized = true
	}

	async close(): Promise<void> {
		// Flush any pending keys on close
		if (this._flushTimer) {
			clearTimeout(this._flushTimer)
			this._flushTimer = null
			await this._flushKeys()
		}
	}

	// ─── Auth credentials ──────────────────────────────────────────────────

	async loadCreds(): Promise<AuthenticationCreds | null> {
		await this.initialize()
		try {
			const data = await this._readJson<AuthenticationCreds>('creds.json')
			return data ?? initAuthCreds()
		} catch {
			return initAuthCreds()
		}
	}

	async saveCreds(creds: AuthenticationCreds): Promise<void> {
		await this.initialize()
		await this._writeJson('creds.json', creds)
	}

	// ─── Signal key store ──────────────────────────────────────────────────

	async getSignalData<T extends keyof SignalDataTypeMap>(
		type: T,
		ids: string[]
	): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
		await this.initialize()
		const result: { [id: string]: SignalDataTypeMap[T] } = {}

		let typeData = this._keysData![type]
		if (!typeData) {
			typeData = {}
			this._keysData![type] = typeData
		}

		let needsFlush = false

		await Promise.all(
			ids.map(async id => {
				let value = typeData[id]
				if (value === undefined) {
					// Fallback to old individual file format for backward compatibility
					const filename = this._signalFilename(type, id)
					const raw = await this._readJson<any>(filename)
					if (raw !== null) {
						value = raw
						typeData[id] = value // migrate to keys.json
						needsFlush = true
					}
				}

				if (value !== undefined && value !== null) {
					// app-state-sync-key values need protobuf reconstruction
					result[id] =
						type === 'app-state-sync-key' && value
							? (proto.Message.AppStateSyncKeyData.fromObject(value as object) as unknown as SignalDataTypeMap[T])
							: value
				}
			})
		)

		if (needsFlush) {
			this._scheduleFlush()
		}

		return result
	}

	async setSignalData(data: SignalDataSet): Promise<void> {
		await this.initialize()

		for (const type in data) {
			const typeData = data[type as keyof SignalDataTypeMap]
			if (!typeData) continue

			if (!this._keysData![type]) {
				this._keysData![type] = {}
			}

			for (const id in typeData) {
				const value = typeData[id]
				if (value === null || value === undefined) {
					delete this._keysData![type][id]
				} else {
					this._keysData![type][id] = value
				}
			}
		}

		this._scheduleFlush()
	}

	private _scheduleFlush() {
		if (this._flushTimer) {
			clearTimeout(this._flushTimer)
		}
		this._flushTimer = setTimeout(() => {
			this._flushTimer = null
			this._flushKeys().catch(() => {})
		}, 50)
	}

	private async _flushKeys() {
		await this._writeJson('keys.json', this._keysData)
	}

	// ─── Chat state ───────────────────────────────────────────────────────

	async loadChats(): Promise<Chat[]> {
		await this.initialize()
		const index = await this._readJson<string[]>('chats-index.json')
		if (!index) return []
		const chats = await Promise.all(index.map(jid => this._readJson<Chat>(`chat-${this._sanitize(jid)}.json`)))
		return chats.filter((c): c is Chat => c !== null)
	}

	async saveChat(chat: Chat): Promise<void> {
		await this.initialize()
		if (!chat.id) return
		await this._writeJson(`chat-${this._sanitize(chat.id)}.json`, chat)
		// Update index
		const index = (await this._readJson<string[]>('chats-index.json')) ?? []
		if (!index.includes(chat.id)) {
			index.push(chat.id)
			await this._writeJson('chats-index.json', index)
		}
	}

	async deleteChat(jid: string): Promise<void> {
		await this.initialize()
		await this._deleteFile(`chat-${this._sanitize(jid)}.json`)
		const index = (await this._readJson<string[]>('chats-index.json')) ?? []
		const filtered = index.filter(id => id !== jid)
		await this._writeJson('chats-index.json', filtered)
	}

	// ─── Plugin data ──────────────────────────────────────────────────────

	async getPluginData<T>(pluginName: string, key: string): Promise<T | null> {
		await this.initialize()
		return this._readJson<T>(`plugin-${this._sanitize(pluginName)}-${this._sanitize(key)}.json`)
	}

	async setPluginData<T>(pluginName: string, key: string, data: T): Promise<void> {
		await this.initialize()
		await this._writeJson(`plugin-${this._sanitize(pluginName)}-${this._sanitize(key)}.json`, data)
	}

	async deletePluginData(pluginName: string, key: string): Promise<void> {
		await this.initialize()
		await this._deleteFile(`plugin-${this._sanitize(pluginName)}-${this._sanitize(key)}.json`)
	}

	// ─── Private helpers ──────────────────────────────────────────────────

	private _getLock(filePath: string): Mutex {
		if (!this._fileLocks.has(filePath)) {
			this._fileLocks.set(filePath, new Mutex())
		}

		return this._fileLocks.get(filePath)!
	}

	private async _readJson<T>(filename: string): Promise<T | null> {
		const filePath = join(this._folder, filename)
		const lock = this._getLock(filePath)
		return lock.runExclusive(async () => {
			try {
				const raw = await readFile(filePath, 'utf-8')
				return JSON.parse(raw, BufferJSON.reviver) as T
			} catch {
				return null
			}
		})
	}

	private async _writeJson(filename: string, data: unknown): Promise<void> {
		const filePath = join(this._folder, filename)
		const lock = this._getLock(filePath)
		return lock.runExclusive(async () => {
			await writeFile(filePath, JSON.stringify(data, BufferJSON.replacer))
		})
	}

	private async _deleteFile(filename: string): Promise<void> {
		const filePath = join(this._folder, filename)
		const lock = this._getLock(filePath)
		return lock.runExclusive(async () => {
			try {
				await unlink(filePath)
			} catch {
				// File may not exist — that's fine
			}
		})
	}

	/** Mirror useMultiFileAuthState's key naming so directories are backward compatible */
	private _signalFilename(type: keyof SignalDataTypeMap, id: string): string {
		// Replicate fixFileName: replace / with __ and : with -
		const fixedType = String(type).replace(/\//g, '__').replace(/:/g, '-')
		const fixedId = String(id).replace(/\//g, '__').replace(/:/g, '-')
		return `${fixedType}-${fixedId}.json`
	}

	private _sanitize(str: string): string {
		return str.replace(/[^a-zA-Z0-9_-]/g, '_')
	}
}
