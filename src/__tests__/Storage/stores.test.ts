import { MemoryStore } from '../../Storage/MemoryStore'
import { initAuthCreds } from '../../Utils/auth-utils'

describe('MemoryStore', () => {
	let store: MemoryStore

	beforeEach(() => {
		store = new MemoryStore()
	})

	// ─── Auth credentials ────────────────────────────────────────────────

	it('returns null for creds before first save', async () => {
		const creds = await store.loadCreds()
		expect(creds).toBeNull()
	})

	it('persists and retrieves credentials', async () => {
		const creds = initAuthCreds()
		await store.saveCreds(creds)
		const loaded = await store.loadCreds()
		expect(loaded?.registrationId).toBe(creds.registrationId)
	})

	it('overwrites credentials on second save', async () => {
		const creds1 = initAuthCreds()
		const creds2 = initAuthCreds()
		await store.saveCreds(creds1)
		await store.saveCreds(creds2)
		const loaded = await store.loadCreds()
		expect(loaded?.registrationId).toBe(creds2.registrationId)
	})

	// ─── Signal keys ────────────────────────────────────────────────────

	it('returns empty object for missing signal keys', async () => {
		const result = await store.getSignalData('session', ['missing-id'])
		expect(result).toEqual({})
	})

	it('stores and retrieves signal session data', async () => {
		const data = new Uint8Array([1, 2, 3, 4])
		await store.setSignalData({ session: { 'abc.0': data } })
		const result = await store.getSignalData('session', ['abc.0'])
		expect(result['abc.0']).toEqual(data)
	})

	it('deletes signal data when value is null', async () => {
		const data = new Uint8Array([1, 2, 3])
		await store.setSignalData({ session: { 'key-to-delete': data } })
		await store.setSignalData({ session: { 'key-to-delete': null } })
		const result = await store.getSignalData('session', ['key-to-delete'])
		expect(result['key-to-delete']).toBeUndefined()
	})

	it('handles multiple types in a single setSignalData call', async () => {
		const sessionData = new Uint8Array([1])
		const preKeyData = { private: new Uint8Array([2]), public: new Uint8Array([3]) }
		await store.setSignalData({
			session: { 'test.0': sessionData },
			'pre-key': { '1': preKeyData }
		})

		const sessions = await store.getSignalData('session', ['test.0'])
		const preKeys = await store.getSignalData('pre-key', ['1'])
		expect(sessions['test.0']).toEqual(sessionData)
		expect(preKeys['1']).toEqual(preKeyData)
	})

	// ─── Chat state ──────────────────────────────────────────────────────

	it('returns empty array when no chats exist', async () => {
		const chats = await store.loadChats()
		expect(chats).toEqual([])
	})

	it('stores and retrieves chats', async () => {
		await store.saveChat({ id: 'abc@s.whatsapp.net' })
		const chats = await store.loadChats()
		expect(chats).toHaveLength(1)
		expect(chats[0]!.id).toBe('abc@s.whatsapp.net')
	})

	it('deletes a chat', async () => {
		await store.saveChat({ id: 'abc@s.whatsapp.net' })
		await store.deleteChat('abc@s.whatsapp.net')
		const chats = await store.loadChats()
		expect(chats).toHaveLength(0)
	})

	// ─── Plugin data ─────────────────────────────────────────────────────

	it('returns null for missing plugin data', async () => {
		const data = await store.getPluginData('my-plugin', 'some-key')
		expect(data).toBeNull()
	})

	it('stores and retrieves plugin data', async () => {
		await store.setPluginData('my-plugin', 'counter', 42)
		const val = await store.getPluginData<number>('my-plugin', 'counter')
		expect(val).toBe(42)
	})

	it('deletes plugin data', async () => {
		await store.setPluginData('my-plugin', 'counter', 42)
		await store.deletePluginData('my-plugin', 'counter')
		const val = await store.getPluginData<number>('my-plugin', 'counter')
		expect(val).toBeNull()
	})

	it('namespaces plugin data by plugin name', async () => {
		await store.setPluginData('plugin-a', 'key', 'a-value')
		await store.setPluginData('plugin-b', 'key', 'b-value')
		expect(await store.getPluginData('plugin-a', 'key')).toBe('a-value')
		expect(await store.getPluginData('plugin-b', 'key')).toBe('b-value')
	})

	// ─── Diagnostics ─────────────────────────────────────────────────────

	it('reports correct key count', async () => {
		await store.setSignalData({ session: { 'a.0': new Uint8Array([1]) } })
		await store.setSignalData({ session: { 'b.0': new Uint8Array([2]) } })
		expect(store.signalKeyCount).toBe(2)
	})

	it('clear() removes all data', async () => {
		const creds = initAuthCreds()
		await store.saveCreds(creds)
		await store.setSignalData({ session: { 'x.0': new Uint8Array([1]) } })
		store.clear()
		expect(await store.loadCreds()).toBeNull()
		expect(store.signalKeyCount).toBe(0)
	})
})
