import { jest } from '@jest/globals'
import { PluginRegistry } from '../../Plugins/PluginRegistry'
import type { WAKitPlugin } from '../../Plugins/types'

// Minimal mock WAKitClient for testing — only plugin lifecycle methods needed
const mockClient = {} as import('../../client/WAKitClient').WAKitClient

function makePlugin(overrides: Partial<WAKitPlugin> = {}): WAKitPlugin {
	return {
		name: 'test-plugin',
		version: '1.0.0',
		install: jest.fn<any>().mockResolvedValue(undefined),
		uninstall: jest.fn<any>().mockResolvedValue(undefined),
		...overrides
	}
}

describe('PluginRegistry', () => {
	let registry: PluginRegistry

	beforeEach(() => {
		registry = new PluginRegistry()
	})

	it('installs a plugin and marks it as installed', async () => {
		const plugin = makePlugin()
		await registry.install(plugin, mockClient)

		expect(registry.isInstalled('test-plugin')).toBe(true)
		expect(plugin.install).toHaveBeenCalledWith(mockClient)
	})

	it('is idempotent — does not install twice', async () => {
		const plugin = makePlugin()
		await registry.install(plugin, mockClient)
		await registry.install(plugin, mockClient)

		expect(plugin.install).toHaveBeenCalledTimes(1)
	})

	it('uninstalls a plugin and removes it from the registry', async () => {
		const plugin = makePlugin()
		await registry.install(plugin, mockClient)
		await registry.uninstall('test-plugin', mockClient)

		expect(registry.isInstalled('test-plugin')).toBe(false)
		expect(plugin.uninstall).toHaveBeenCalledWith(mockClient)
	})

	it('uninstall is a no-op if plugin is not installed', async () => {
		// Should not throw
		await expect(registry.uninstall('nonexistent', mockClient)).resolves.toBeUndefined()
	})

	it('returns installedNames in installation order', async () => {
		const a = makePlugin({ name: 'alpha' })
		const b = makePlugin({ name: 'beta' })
		await registry.install(a, mockClient)
		await registry.install(b, mockClient)

		expect(registry.installedNames()).toEqual(['alpha', 'beta'])
	})

	it('validates plugin name is non-empty', async () => {
		const plugin = makePlugin({ name: '' })
		await expect(registry.install(plugin, mockClient)).rejects.toThrow('"name" must be a non-empty string')
	})

	it('validates plugin version is present', async () => {
		const plugin = makePlugin({ version: '' })
		await expect(registry.install(plugin, mockClient)).rejects.toThrow('"version"')
	})

	it('validates install is a function', async () => {
		const plugin = makePlugin({ install: undefined as unknown as WAKitPlugin['install'] })
		await expect(registry.install(plugin, mockClient)).rejects.toThrow('"install" must be a function')
	})

	it('throws when a declared dependency is not installed', async () => {
		const plugin = makePlugin({
			name: 'dependent',
			requires: ['missing-dep']
		})
		await expect(registry.install(plugin, mockClient)).rejects.toThrow(
			/requires plugin "missing-dep" which is not installed/
		)
	})

	it('succeeds when all declared dependencies are already installed', async () => {
		const dep = makePlugin({ name: 'base' })
		await registry.install(dep, mockClient)

		const plugin = makePlugin({ name: 'dependent', requires: ['base'] })
		await expect(registry.install(plugin, mockClient)).resolves.toBeUndefined()
	})

	it('marks plugin as failed when install() throws', async () => {
		const plugin = makePlugin({
			install: jest.fn<any>().mockRejectedValue(new Error('install-fail'))
		})

		await expect(registry.install(plugin, mockClient)).rejects.toThrow('install-fail')
		expect(registry.isInstalled('test-plugin')).toBe(false)
	})

	it('provides diagnostic information', async () => {
		const plugin = makePlugin({ name: 'diag-plugin', version: '2.0.0' })
		await registry.install(plugin, mockClient)

		const diag = registry.diagnostics()
		expect(diag).toHaveLength(1)
		expect(diag[0]).toMatchObject({ name: 'diag-plugin', version: '2.0.0', state: 'installed' })
	})
})
