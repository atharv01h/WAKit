/**
 * Permissions a plugin may declare to communicate its capabilities to the host.
 * WAKit uses these for documentation and future sandboxing support.
 */
export type PluginPermission =
	| 'messages:read'
	| 'messages:write'
	| 'contacts:read'
	| 'groups:read'
	| 'groups:write'
	| 'media:read'
	| 'media:write'
	| 'presence:write'
	| 'socket:raw'

/**
 * The contract every WAKit plugin must satisfy.
 *
 * @example
 * ```ts
 * import { definePlugin } from 'wakit'
 *
 * export default definePlugin({
 *   name: 'my-analytics',
 *   version: '1.0.0',
 *   permissions: ['messages:read'],
 *   async install(client) {
 *     client.on('messages.upsert', ({ messages }) => {
 *       analytics.track(messages.length)
 *     })
 *   }
 * })
 * ```
 */
export interface WAKitPlugin {
	/** Unique plugin identifier (npm-package-name convention recommended) */
	readonly name: string
	/** SemVer string */
	readonly version: string
	/** Optional human-readable description */
	readonly description?: string
	/**
	 * Names of other plugins this plugin depends on.
	 * WAKit ensures dependencies are installed before this plugin.
	 */
	readonly requires?: readonly string[]
	/**
	 * Declared permissions. Used for documentation, developer tooling,
	 * and future sandboxing. Not enforced at runtime in v1.
	 */
	readonly permissions?: readonly PluginPermission[]
	/**
	 * Called when the plugin is installed on a WAKitClient.
	 * This is where you attach event listeners, register middleware, etc.
	 * Must not throw — if it does, the error is re-thrown and installation fails.
	 */
	install(client: import('../client/WAKitClient').WAKitClient): Promise<void>
	/**
	 * Called when the plugin is uninstalled (e.g., before client.destroy()).
	 * Use to clean up timers, listeners, and external connections.
	 */
	uninstall?(client: import('../client/WAKitClient').WAKitClient): Promise<void>
}

/**
 * Type-safe helper for defining a plugin with full IntelliSense support.
 *
 * @example
 * ```ts
 * export default definePlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   async install(client) { ... }
 * })
 * ```
 */
export function definePlugin(plugin: WAKitPlugin): WAKitPlugin {
	return plugin
}
