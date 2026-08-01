import type { UserFacingSocketConfig } from '../Types'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state'
import { makeCacheableSignalKeyStore } from '../Utils/auth-utils'
import { fetchLatestWAKitVersion } from '../Utils/generics'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults'
import logger from '../Utils/logger'
import { WAKitClient, type WAKitClientConfig } from './WAKitClient'

/**
 * Zero-configuration entry point for WAKit.
 *
 * Sensible defaults handle everything automatically:
 * - Auth state is loaded/created in the given directory (or from a provided auth state)
 * - The latest WA version is fetched and used
 * - Session credentials are saved automatically on every update
 * - Reconnection is handled with exponential backoff
 *
 * @example Minimal usage
 * ```ts
 * import { createClient } from 'wakit'
 *
 * const client = await createClient({ auth: './my-session' })
 * client.on('connection.update', ({ qr }) => {
 *   if (qr) console.log('Scan QR:', qr)
 * })
 * await client.sendMessage('1234567890@s.whatsapp.net', { text: 'hello' })
 * ```
 *
 * @example Full configuration
 * ```ts
 * const client = await createClient({
 *   auth: './session',
 *   autoReconnect: true,
 *   maxReconnectAttempts: 10,
 *   browser: Browsers.ubuntu('Chrome'),
 *   shouldIgnoreJid: jid => isJidBroadcast(jid),
 * })
 * ```
 *
 * @example With existing auth state (WAKit-compatible migration path)
 * ```ts
 * const { state, saveCreds } = await useMultiFileAuthState('./session')
 * const client = await createClient({ auth: state })
 * client.on('creds.update', saveCreds)
 * ```
 */
export async function createClient(config: WAKitClientConfig): Promise<WAKitClient> {
	// Resolve auth — accept either a directory path string or a full AuthenticationState
	let resolvedAuth: UserFacingSocketConfig['auth']
	let autoSaveCreds = false

	if (typeof config.auth === 'string') {
		const { state, saveCreds } = await useMultiFileAuthState(config.auth)
		resolvedAuth = {
			creds: state.creds,
			// Wrap with caching layer for performance (mirrors the example.ts pattern)
			keys: makeCacheableSignalKeyStore(state.keys, config.logger ?? logger)
		}
		// Wire auto-save — we'll attach this listener after client is constructed
		autoSaveCreds = true

		// Store saveCreds for later wiring
		;(config as WAKitClientConfig & { _saveCreds?: () => Promise<void> })._saveCreds = saveCreds
	} else if (config.auth && typeof (config.auth as import('../Storage/types').WAKitStore).getSignalData === 'function') {
		const store = config.auth as import('../Storage/types').WAKitStore
		if (store.initialize) await store.initialize()
		
		const { initAuthCreds } = await import('../Utils/auth-utils')
		const creds = await store.loadCreds() ?? initAuthCreds()
		
		resolvedAuth = {
			creds,
			keys: makeCacheableSignalKeyStore({
				get: (type, ids) => store.getSignalData(type, ids),
				set: (data) => store.setSignalData(data)
			}, config.logger ?? logger)
		}
		
		autoSaveCreds = true
		;(config as WAKitClientConfig & { _saveCreds?: () => Promise<void> })._saveCreds = async () => {
			if (client?.authState?.creds) {
				await store.saveCreds(client.authState.creds)
			}
		}
	} else {
		resolvedAuth = config.auth as import('../Types').AuthenticationState
	}

	// Fetch latest WA version unless caller provided one
	let version = config.version
	if (!version) {
		const result = await fetchLatestWAKitVersion()
		version = result.version
	}

	// Build the final socket config by merging defaults → user config → resolved auth
	const socketConfig: UserFacingSocketConfig = {
		...DEFAULT_CONNECTION_CONFIG,
		...(config as Partial<UserFacingSocketConfig>),
		version,
		auth: resolvedAuth,
		// If caller didn't supply a logger, use WAKit's silent default
		logger: config.logger ?? DEFAULT_CONNECTION_CONFIG.logger
	}

	const client = new WAKitClient(config, socketConfig)

	// Wire auto-save before first connect so no creds.update is missed
	if (autoSaveCreds) {
		const saveCreds = (config as WAKitClientConfig & { _saveCreds?: () => Promise<void> })._saveCreds!
		client.on('creds.update', () => {
			saveCreds().catch((err: unknown) => {
				socketConfig.logger?.error({ err }, 'wakit: failed to auto-save credentials')
			})
		})
	}

	await client.connect()

	return client
}
