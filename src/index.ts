import makeWASocket from './Socket/index'

export * from '../WAProto/index.js'
export * from './Utils/index'
export * from './Types/index'
export * from './Defaults/index'
export * from './WABinary/index'
export * from './WAM/index'
export * from './WAUSync/index'

export type WASocket = ReturnType<typeof makeWASocket>
export { makeWASocket }
export default makeWASocket

// ─── WAKit next-gen APIs ──────────────────────────────────────────────────────

export { createClient, WAKitClient } from './client/index'
export type { WAKitClientConfig } from './client/index'

export { createPipeline } from './Middleware/index'
export type {
	Middleware,
	MiddlewarePipeline,
	IncomingMessageContext,
	OutgoingMessageContext,
	RateLimitOptions,
	SimpleMetricsCollector
} from './Middleware/index'
export {
	incomingLoggingMiddleware,
	outgoingLoggingMiddleware,
	rateLimitMiddleware,
	filterJidMiddleware,
	incomingMetricsMiddleware,
	outgoingMetricsMiddleware
} from './Middleware/index'

export { definePlugin, PluginRegistry } from './Plugins/index'
export type { WAKitPlugin, PluginPermission } from './Plugins/index'

export { MemoryStore, JsonFileStore } from './Storage/index'
export type { WAKitStore } from './Storage/index'

export { NoopTelemetry, NOOP_TELEMETRY, WAKitMetrics } from './Telemetry/index'
export type { WAKitTelemetry } from './Telemetry/index'

export { CircuitBreaker } from './Utils/circuit-breaker'
export type { CircuitState, CircuitBreakerOptions } from './Utils/circuit-breaker'

export { wrapEventBus } from './Utils/event-bus'
export type { WAKitEventBus, EventHistoryEntry, WAKitEventBusOptions } from './Utils/event-bus'
