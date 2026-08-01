import type { AuthenticationCreds, Chat, SignalDataSet, SignalDataTypeMap } from '../Types'

/**
 * The WAKit storage abstraction.
 *
 * Implement this interface to use any backend (SQLite, Redis, PostgreSQL, etc.)
 * with WAKit's zero-config client.
 *
 * An instance is passed to createClient() via the `store` option.
 *
 * @example
 * ```ts
 * const client = await createClient({
 *   auth: myCustomStore
 * })
 * ```
 */
export interface WAKitStore {
	// ─── Auth credentials ───────────────────────────────────────────────────

	/** Load persisted authentication credentials. Returns null if none exist. */
	loadCreds(): Promise<AuthenticationCreds | null>
	/** Persist updated authentication credentials */
	saveCreds(creds: AuthenticationCreds): Promise<void>

	// ─── Signal key store ────────────────────────────────────────────────────

	/**
	 * Read Signal protocol keys of a given type.
	 * Must return a partial map — missing IDs should simply be absent from the result.
	 */
	getSignalData<T extends keyof SignalDataTypeMap>(
		type: T,
		ids: string[]
	): Promise<{ [id: string]: SignalDataTypeMap[T] }>

	/** Write a set of Signal protocol key mutations */
	setSignalData(data: SignalDataSet): Promise<void>

	// ─── Chat state ──────────────────────────────────────────────────────────

	/** Load all persisted chats */
	loadChats(): Promise<Chat[]>
	/** Persist a chat (upsert by chat.id) */
	saveChat(chat: Chat): Promise<void>
	/** Delete a chat by JID */
	deleteChat(jid: string): Promise<void>

	// ─── Plugin data ─────────────────────────────────────────────────────────

	/** Read plugin-specific data */
	getPluginData<T>(pluginName: string, key: string): Promise<T | null>
	/** Write plugin-specific data */
	setPluginData<T>(pluginName: string, key: string, data: T): Promise<void>
	/** Delete plugin-specific data */
	deletePluginData(pluginName: string, key: string): Promise<void>

	// ─── Lifecycle ────────────────────────────────────────────────────────────

	/** Called on first use. Perform any async initialization here (e.g., run migrations). */
	initialize?(): Promise<void>
	/** Called when the client is destroyed. Close connections, flush writes, etc. */
	close?(): Promise<void>
}
