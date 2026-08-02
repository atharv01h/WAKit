import { Boom } from '@hapi/boom'
import type { WAKitPlugin } from './types'
import type { WAKitClient } from '../client/WAKitClient'

type PluginState = 'installed' | 'failed' | 'disabled'

interface PluginEntry {
	plugin: WAKitPlugin
	state: PluginState
	installedAt: Date
}

/**
 * PluginRegistry manages the full lifecycle of WAKit plugins:
 * - Validates metadata (name, version, install)
 * - Resolves dependencies before installation
 * - Calls initialize → install → (ready after all plugins) lifecycle hooks
 * - Calls uninstall/destroy on removal
 * - Prevents duplicate registration
 * - Supports reload (uninstall + reinstall) and enable/disable
 *
 * The registry is owned by WAKitClient and is not meant to be used directly.
 */
export class PluginRegistry {
	private readonly _registry = new Map<string, PluginEntry>()

	/**
	 * Install a plugin. Dependencies are validated before installation.
	 * Lifecycle: validate → dependency check → initialize → install.
	 * If installation fails, the plugin is NOT added to the registry.
	 */
	async install(plugin: WAKitPlugin, client: WAKitClient): Promise<void> {
		this._validate(plugin)

		if (this._registry.has(plugin.name)) {
			// Already installed — idempotent
			return
		}

		// Resolve dependencies first
		this._checkDependencies(plugin)

		const proxiedClient = this._createPluginClientProxy(client, plugin.name)

		try {
			await plugin.initialize?.(proxiedClient)
			await plugin.install(proxiedClient)
			this._registry.set(plugin.name, {
				plugin,
				state: 'installed',
				installedAt: new Date()
			})
		} catch (err) {
			// Mark as failed but remove from registry so it can be retried
			throw new Boom(
				`Plugin "${plugin.name}" failed during installation: ${err instanceof Error ? err.message : String(err)}`,
				{ statusCode: 500, data: { err } }
			)
		}
	}

	/**
	 * Call the `ready()` hook on all installed plugins.
	 * Invoke this after ALL plugins have been registered.
	 */
	async callReady(client: WAKitClient): Promise<void> {
		for (const [, entry] of this._registry) {
			if (entry.state === 'installed') {
				const proxiedClient = this._createPluginClientProxy(client, entry.plugin.name)
				await entry.plugin.ready?.(proxiedClient)
			}
		}
	}

	/**
	 * Uninstall a plugin by name. Calls plugin.uninstall() (or destroy()) if defined.
	 * No-ops if the plugin is not installed.
	 */
	async uninstall(name: string, client: WAKitClient): Promise<void> {
		const entry = this._registry.get(name)
		if (!entry || entry.state === 'failed') {
			this._registry.delete(name)
			return
		}

		try {
			// Prefer uninstall; fall back to destroy
			const cleanup = entry.plugin.uninstall ?? entry.plugin.destroy
			if (cleanup) {
				const proxiedClient = this._createPluginClientProxy(client, name)
				await cleanup(proxiedClient)
			}
		} finally {
			this._registry.delete(name)
		}
	}

	/**
	 * Reload a plugin: uninstall then reinstall.
	 * The plugin object is replaced with `newPlugin` if provided, otherwise the
	 * original plugin definition is reused.
	 */
	async reload(name: string, client: WAKitClient, newPlugin?: WAKitPlugin): Promise<void> {
		const entry = this._registry.get(name)
		const target = newPlugin ?? entry?.plugin
		if (!target) {
			throw new Boom(`Plugin "${name}" not found. Cannot reload a plugin that was never installed.`, {
				statusCode: 404
			})
		}

		await this.uninstall(name, client)
		await this.install(target, client)
	}

	/**
	 * Disable an installed plugin without uninstalling it.
	 * The plugin's listeners/middleware remain registered — use for temporary pausing.
	 */
	disable(name: string): void {
		const entry = this._registry.get(name)
		if (!entry) {
			throw new Boom(`Plugin "${name}" not found.`, { statusCode: 404 })
		}

		if (entry.state !== 'installed') {
			throw new Boom(`Plugin "${name}" is not installed.`, { statusCode: 400 })
		}

		entry.state = 'disabled'
	}

	/**
	 * Re-enable a previously disabled plugin.
	 */
	enablePlugin(name: string): void {
		const entry = this._registry.get(name)
		if (!entry) {
			throw new Boom(`Plugin "${name}" not found.`, { statusCode: 404 })
		}

		if (entry.state !== 'disabled') {
			throw new Boom(`Plugin "${name}" is not disabled.`, { statusCode: 400 })
		}

		entry.state = 'installed'
	}

	/** Returns true if a plugin with the given name is installed and active */
	isInstalled(name: string): boolean {
		return this._registry.get(name)?.state === 'installed'
	}

	/** Returns a list of all installed (active) plugin names in installation order */
	installedNames(): string[] {
		return [...this._registry.entries()].filter(([, e]) => e.state === 'installed').map(([name]) => name)
	}

	/** Returns diagnostic information about all registered plugins */
	diagnostics(): Array<{ name: string; version: string; author?: string; state: PluginState; installedAt: Date }> {
		return [...this._registry.entries()].map(([name, entry]) => ({
			name,
			version: entry.plugin.version,
			author: entry.plugin.author,
			state: entry.state,
			installedAt: entry.installedAt
		}))
	}

	// ─── Private helpers ────────────────────────────────────────────────────

	private _validate(plugin: WAKitPlugin): void {
		if (!plugin.name || typeof plugin.name !== 'string' || plugin.name.trim() === '') {
			throw new Boom('Plugin "name" must be a non-empty string.', { statusCode: 400 })
		}

		if (!plugin.version || typeof plugin.version !== 'string') {
			throw new Boom(`Plugin "${plugin.name}": "version" must be a non-empty string.`, { statusCode: 400 })
		}

		if (typeof plugin.install !== 'function') {
			throw new Boom(`Plugin "${plugin.name}": "install" must be a function.`, { statusCode: 400 })
		}
	}

	/**
	 * Checks that all declared dependencies are already installed.
	 * Throws with a clear message if any are missing.
	 */
	private _checkDependencies(plugin: WAKitPlugin): void {
		if (!plugin.requires || plugin.requires.length === 0) return

		for (const depName of plugin.requires) {
			if (!this.isInstalled(depName)) {
				throw new Boom(
					`Plugin "${plugin.name}" requires plugin "${depName}" which is not installed. ` +
						`Install "${depName}" before "${plugin.name}".`,
					{ statusCode: 400 }
				)
			}
		}
	}

	/**
	 * Wraps the WAKitClient in a proxy that intercepts event listeners and middleware.
	 * When the plugin is disabled, these hooks automatically become no-ops.
	 */
	private _createPluginClientProxy(client: WAKitClient, pluginName: string): WAKitClient {
		const listenerMap = new WeakMap<Function, Function>()
		
		return new Proxy(client, {
			get: (target, prop, receiver) => {
				const value = Reflect.get(target, prop, receiver)
				if (typeof value !== 'function') return value

				if (prop === 'on') {
					return (event: any, listener: Function) => {
						const wrappedListener = (...args: any[]) => {
							if (this.isInstalled(pluginName)) return listener(...args)
						}
						listenerMap.set(listener, wrappedListener)
						target.on(event, wrappedListener as any)
						return receiver
					}
				}
				
				if (prop === 'off') {
					return (event: any, listener: Function) => {
						const wrapped = listenerMap.get(listener)
						target.off(event, (wrapped ?? listener) as any)
						return receiver
					}
				}

				if (prop === 'useIncoming') {
					return (middleware: any, id?: string) => {
						const wrappedMiddleware = async (ctx: any, next: any) => {
							if (this.isInstalled(pluginName)) return middleware(ctx, next)
							return next()
						}
						return target.useIncoming(wrappedMiddleware, id)
					}
				}

				if (prop === 'useOutgoing') {
					return (middleware: any, id?: string) => {
						const wrappedMiddleware = async (ctx: any, next: any) => {
							if (this.isInstalled(pluginName)) return middleware(ctx, next)
							return next()
						}
						return target.useOutgoing(wrappedMiddleware, id)
					}
				}
				
				if (prop === 'process') {
					return (handler: Function) => {
						const wrappedHandler = (...args: any[]) => {
							if (this.isInstalled(pluginName)) return handler(...args)
						}
						return target.process(wrappedHandler as any)
					}
				}

				return value.bind(target)
			}
		})
	}
}
