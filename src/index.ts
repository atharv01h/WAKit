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

// ─── Middleware ───────────────────────────────────────────────────────────────

export { createPipeline, createGroupPipeline } from './Middleware/index'
export type {
	Middleware,
	ErrorMiddleware,
	MiddlewarePipeline,
	NamedMiddlewareEntry,
	GroupPipeline,
	IncomingMessageContext,
	OutgoingMessageContext,
	RateLimitOptions,
	SimpleMetricsCollector,
	DedupOptions
} from './Middleware/index'
export {
	incomingLoggingMiddleware,
	outgoingLoggingMiddleware,
	rateLimitMiddleware,
	filterJidMiddleware,
	incomingMetricsMiddleware,
	outgoingMetricsMiddleware,
	errorLoggingMiddleware,
	dedupMiddleware
} from './Middleware/index'

// ─── Plugins ──────────────────────────────────────────────────────────────────

export { definePlugin, PluginRegistry, LoggerPlugin, WebhookPlugin } from './Plugins/index'
export type { WAKitPlugin, PluginPermission, LoggerPluginOptions, WebhookPluginOptions } from './Plugins/index'

// ─── Storage ──────────────────────────────────────────────────────────────────

export { MemoryStore, JsonFileStore } from './Storage/index'
export type { WAKitStore } from './Storage/index'

// ─── Telemetry ────────────────────────────────────────────────────────────────

export { NoopTelemetry, NOOP_TELEMETRY, WAKitMetrics } from './Telemetry/index'
export type { WAKitTelemetry } from './Telemetry/index'

// ─── Utils ────────────────────────────────────────────────────────────────────

export { CircuitBreaker } from './Utils/circuit-breaker'
export type { CircuitState, CircuitBreakerOptions } from './Utils/circuit-breaker'

export { wrapEventBus } from './Utils/event-bus'
export type { WAKitEventBus, EventHistoryEntry, WAKitEventBusOptions } from './Utils/event-bus'

// ─── REST API ─────────────────────────────────────────────────────────────────

export { WAKitRestServer } from './REST/index'
export type { RestApiConfig, AuthConfig, RateLimitConfig, CorsConfig, RouteDefinition } from './REST/index'

// ─── Scheduler ───────────────────────────────────────────────────────────────

export { WAKitScheduler } from './Scheduler/index'
export type { JobFn, JobOptions, JobStatus, SchedulerConfig, DayOfWeek } from './Scheduler/index'

// ─── Recorder ────────────────────────────────────────────────────────────────

export { WAKitRecorder } from './Recorder/index'
export type { RecordedEntry, RecordedSession, ReplayOptions, RecorderConfig } from './Recorder/index'
