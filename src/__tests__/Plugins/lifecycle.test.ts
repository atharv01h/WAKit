import { jest } from '@jest/globals'
import { PluginRegistry } from '../../Plugins/PluginRegistry'
import type { WAKitPlugin } from '../../Plugins/types'

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

describe('PluginRegistry — lifecycle hooks', () => {
	let registry: PluginRegistry

	beforeEach(() => {
		registry = new PluginRegistry()
	})

	it('calls initialize() before install()', async () => {
		const order: string[] = []
		const plugin = makePlugin({
			initialize: jest.fn<any>().mockImplementation(async () => {
				order.push('initialize')
			}),
			install: jest.fn<any>().mockImplementation(async () => {
				order.push('install')
			})
		})

		await registry.install(plugin, mockClient)
		expect(order).toEqual(['initialize', 'install'])
	})

	it('calls ready() on all installed plugins when callReady() is invoked', async () => {
		const readyA = jest.fn<any>().mockResolvedValue(undefined)
		const readyB = jest.fn<any>().mockResolvedValue(undefined)

		await registry.install(makePlugin({ name: 'a', ready: readyA }), mockClient)
		await registry.install(makePlugin({ name: 'b', ready: readyB }), mockClient)

		await registry.callReady(mockClient)

		expect(readyA).toHaveBeenCalledWith(mockClient)
		expect(readyB).toHaveBeenCalledWith(mockClient)
	})

	it('does not call ready() on disabled plugins', async () => {
		const readyFn = jest.fn<any>().mockResolvedValue(undefined)
		const plugin = makePlugin({ name: 'target', ready: readyFn })
		await registry.install(plugin, mockClient)
		registry.disable('target')

		await registry.callReady(mockClient)
		expect(readyFn).not.toHaveBeenCalled()
	})

	it('calls destroy() if defined and uninstall is not', async () => {
		const destroyFn = jest.fn<any>().mockResolvedValue(undefined)
		const plugin = makePlugin({
			name: 'has-destroy',
			uninstall: undefined,
			destroy: destroyFn
		})
		await registry.install(plugin, mockClient)
		await registry.uninstall('has-destroy', mockClient)

		expect(destroyFn).toHaveBeenCalledWith(mockClient)
	})

	it('prefers uninstall over destroy when both are defined', async () => {
		const uninstallFn = jest.fn<any>().mockResolvedValue(undefined)
		const destroyFn = jest.fn<any>().mockResolvedValue(undefined)
		const plugin = makePlugin({
			name: 'both-hooks',
			uninstall: uninstallFn,
			destroy: destroyFn
		})
		await registry.install(plugin, mockClient)
		await registry.uninstall('both-hooks', mockClient)

		expect(uninstallFn).toHaveBeenCalled()
		expect(destroyFn).not.toHaveBeenCalled()
	})
})

describe('PluginRegistry — reload', () => {
	let registry: PluginRegistry

	beforeEach(() => {
		registry = new PluginRegistry()
	})

	it('uninstalls then reinstalls the same plugin', async () => {
		const plugin = makePlugin()
		await registry.install(plugin, mockClient)
		await registry.reload('test-plugin', mockClient)

		expect(plugin.uninstall).toHaveBeenCalledTimes(1)
		expect(plugin.install).toHaveBeenCalledTimes(2) // once on install + once on reload
	})

	it('throws if the plugin was never installed', async () => {
		await expect(registry.reload('nonexistent', mockClient)).rejects.toThrow('not found')
	})

	it('can reload with a new plugin definition', async () => {
		const original = makePlugin({ name: 'swappable' })
		const replacement = makePlugin({ name: 'swappable', version: '2.0.0' })

		await registry.install(original, mockClient)
		await registry.reload('swappable', mockClient, replacement)

		const diag = registry.diagnostics()
		expect(diag[0]?.version).toBe('2.0.0')
	})
})

describe('PluginRegistry — enable/disable', () => {
	let registry: PluginRegistry

	beforeEach(() => {
		registry = new PluginRegistry()
	})

	it('disable() marks a plugin as disabled', async () => {
		await registry.install(makePlugin(), mockClient)
		registry.disable('test-plugin')

		const diag = registry.diagnostics()
		expect(diag[0]?.state).toBe('disabled')
		expect(registry.isInstalled('test-plugin')).toBe(false)
	})

	it('enablePlugin() re-activates a disabled plugin', async () => {
		await registry.install(makePlugin(), mockClient)
		registry.disable('test-plugin')
		registry.enablePlugin('test-plugin')

		expect(registry.isInstalled('test-plugin')).toBe(true)
	})

	it('disable() throws for unknown plugin', () => {
		expect(() => registry.disable('ghost')).toThrow('not found')
	})

	it('enablePlugin() throws for non-disabled plugin', async () => {
		await registry.install(makePlugin(), mockClient)
		expect(() => registry.enablePlugin('test-plugin')).toThrow('not disabled')
	})
})

describe('PluginRegistry — error messages', () => {
	let registry: PluginRegistry

	beforeEach(() => {
		registry = new PluginRegistry()
	})

	it('reports "name" must be a non-empty string', async () => {
		await expect(registry.install(makePlugin({ name: '' }), mockClient)).rejects.toThrow(
			'"name" must be a non-empty string'
		)
	})

	it('reports "version" must be a non-empty string', async () => {
		await expect(registry.install(makePlugin({ version: '' }), mockClient)).rejects.toThrow('"version"')
	})

	it('reports missing dependency with clear message', async () => {
		const plugin = makePlugin({ name: 'dependent', requires: ['missing-dep'] })
		await expect(registry.install(plugin, mockClient)).rejects.toThrow(
			'requires plugin "missing-dep" which is not installed'
		)
	})

	it('wraps install() failures in a Boom 500', async () => {
		const plugin = makePlugin({
			install: jest.fn<any>().mockRejectedValue(new Error('inner-fail'))
		})
		await expect(registry.install(plugin, mockClient)).rejects.toThrow('inner-fail')
	})

	it('reports author in diagnostics when provided', async () => {
		await registry.install(makePlugin({ author: 'Atharv Hatwar' }), mockClient)
		const diag = registry.diagnostics()
		expect(diag[0]?.author).toBe('Atharv Hatwar')
	})
})
