import type { WAKitPlugin } from './types'
import type { WAKitClient } from '../client/WAKitClient'

type PluginState = 'installed' | 'failed'

interface PluginEntry {
	plugin: WAKitPlugin
	state: PluginState
	installedAt: Date
}

/**
 * PluginRegistry manages the full lifecycle of WAKit plugins:
 * - Validates metadata (name, version)
 * - Resolves dependencies via topological sort
 * - Detects circular dependencies
 * - Calls install/uninstall in the correct order
 * - Prevents duplicate registration
 *
 * The registry is owned by WAKitClient and is not meant to be used directly.
 */
export class PluginRegistry {
	private readonly _registry = new Map<string, PluginEntry>()

	/**
	 * Install a plugin. Dependencies are validated before installation.
	 * If installation fails, the plugin is marked as 'failed' and the error is rethrown.
	 */
	async install(plugin: WAKitPlugin, client: WAKitClient): Promise<void> {
		this._validate(plugin)

		if (this._registry.has(plugin.name)) {
			// Already installed — idempotent
			return
		}

		// Resolve dependencies first
		await this._resolveDependencies(plugin, client, new Set())

		try {
			await plugin.install(client)
			this._registry.set(plugin.name, {
				plugin,
				state: 'installed',
				installedAt: new Date()
			})
		} catch (err) {
			this._registry.set(plugin.name, {
				plugin,
				state: 'failed',
				installedAt: new Date()
			})
			throw err
		}
	}

	/**
	 * Uninstall a plugin by name. Calls plugin.uninstall() if defined.
	 * No-ops if the plugin is not installed.
	 */
	async uninstall(name: string, client: WAKitClient): Promise<void> {
		const entry = this._registry.get(name)
		if (!entry || entry.state !== 'installed') return

		try {
			await entry.plugin.uninstall?.(client)
		} finally {
			this._registry.delete(name)
		}
	}

	/** Returns true if a plugin with the given name is installed and healthy */
	isInstalled(name: string): boolean {
		return this._registry.get(name)?.state === 'installed'
	}

	/** Returns a list of all installed plugin names in installation order */
	installedNames(): string[] {
		return [...this._registry.entries()].filter(([, e]) => e.state === 'installed').map(([name]) => name)
	}

	/** Returns diagnostic information about all registered plugins */
	diagnostics(): Array<{ name: string; version: string; state: PluginState; installedAt: Date }> {
		return [...this._registry.entries()].map(([name, entry]) => ({
			name,
			version: entry.plugin.version,
			state: entry.state,
			installedAt: entry.installedAt
		}))
	}

	// ─── Private helpers ────────────────────────────────────────────────────

	private _validate(plugin: WAKitPlugin): void {
		if (!plugin.name || typeof plugin.name !== 'string' || plugin.name.trim() === '') {
			throw new Error('WAKit plugin: "name" must be a non-empty string')
		}

		if (!plugin.version || typeof plugin.version !== 'string') {
			throw new Error(`WAKit plugin "${plugin.name}": "version" must be a non-empty string`)
		}

		if (typeof plugin.install !== 'function') {
			throw new Error(`WAKit plugin "${plugin.name}": "install" must be a function`)
		}
	}

	/**
	 * Topologically install all declared dependencies.
	 * Uses DFS with a visiting set for cycle detection.
	 */
	private async _resolveDependencies(plugin: WAKitPlugin, client: WAKitClient, visiting: Set<string>): Promise<void> {
		if (!plugin.requires || plugin.requires.length === 0) return

		for (const depName of plugin.requires) {
			if (visiting.has(depName)) {
				throw new Error(`WAKit plugin "${plugin.name}": circular dependency detected involving "${depName}"`)
			}

			if (this.isInstalled(depName)) {
				// Already installed — nothing to do
				continue
			}

			throw new Error(
				`WAKit plugin "${plugin.name}": required plugin "${depName}" is not installed. ` +
					`Install it before "${plugin.name}".`
			)
		}
	}
}
