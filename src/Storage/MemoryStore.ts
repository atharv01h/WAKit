import type { AuthenticationCreds, Chat, SignalDataSet, SignalDataTypeMap } from '../Types'
import type { WAKitStore } from './types'

/**
 * In-memory WAKitStore implementation.
 *
 * Ideal for:
 * - Unit tests (zero I/O)
 * - Short-lived scripts that don't need session persistence
 * - Development when you want a clean slate on every restart
 *
 * @example
 * ```ts
 * import { MemoryStore } from 'wakit'
 *
 * const store = new MemoryStore()
 * const client = await createClient({ auth: store })
 * ```
 */
export class MemoryStore implements WAKitStore {
	private _creds: AuthenticationCreds | null = null
	private readonly _signal = new Map<string, unknown>()
	private readonly _chats = new Map<string, Chat>()
	private readonly _plugins = new Map<string, unknown>()

	// ─── Auth credentials ──────────────────────────────────────────────────

	async loadCreds(): Promise<AuthenticationCreds | null> {
		return this._creds
	}

	async saveCreds(creds: AuthenticationCreds): Promise<void> {
		this._creds = creds
	}

	// ─── Signal key store ──────────────────────────────────────────────────

	async getSignalData<T extends keyof SignalDataTypeMap>(
		type: T,
		ids: string[]
	): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
		const result: { [id: string]: SignalDataTypeMap[T] } = {}
		for (const id of ids) {
			const key = `${type}::${id}`
			const value = this._signal.get(key)
			if (value !== undefined && value !== null) {
				result[id] = value as SignalDataTypeMap[T]
			}
		}

		return result
	}

	async setSignalData(data: SignalDataSet): Promise<void> {
		for (const type in data) {
			const typeData = data[type as keyof SignalDataTypeMap]
			if (!typeData) continue
			for (const id in typeData) {
				const key = `${type}::${id}`
				const value = typeData[id]
				if (value === null || value === undefined) {
					this._signal.delete(key)
				} else {
					this._signal.set(key, value)
				}
			}
		}
	}

	// ─── Chat state ───────────────────────────────────────────────────────

	async loadChats(): Promise<Chat[]> {
		return [...this._chats.values()]
	}

	async saveChat(chat: Chat): Promise<void> {
		if (chat.id) this._chats.set(chat.id, chat)
	}

	async deleteChat(jid: string): Promise<void> {
		this._chats.delete(jid)
	}

	// ─── Plugin data ──────────────────────────────────────────────────────

	async getPluginData<T>(pluginName: string, key: string): Promise<T | null> {
		const mapKey = `plugin::${pluginName}::${key}`
		return (this._plugins.get(mapKey) as T | undefined) ?? null
	}

	async setPluginData<T>(pluginName: string, key: string, data: T): Promise<void> {
		this._plugins.set(`plugin::${pluginName}::${key}`, data)
	}

	async deletePluginData(pluginName: string, key: string): Promise<void> {
		this._plugins.delete(`plugin::${pluginName}::${key}`)
	}

	// ─── Diagnostic helpers ───────────────────────────────────────────────

	/** Returns the total number of signal keys stored */
	get signalKeyCount(): number {
		return this._signal.size
	}

	/** Returns the total number of chats stored */
	get chatCount(): number {
		return this._chats.size
	}

	/** Clears all stored data */
	clear(): void {
		this._creds = null
		this._signal.clear()
		this._chats.clear()
		this._plugins.clear()
	}
}
