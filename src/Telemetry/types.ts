/**
 * WAKit Telemetry interface.
 *
 * Implement this interface to connect WAKit to any observability backend
 * (OpenTelemetry, Prometheus, Datadog, etc.).
 *
 * WAKit ships with a zero-overhead NoopTelemetry by default.
 * Swap it in createClient() with your production telemetry provider.
 *
 * @example
 * ```ts
 * // Using with OpenTelemetry
 * import { metrics, trace } from '@opentelemetry/api'
 * import { OtelTelemetry } from 'wakit'
 *
 * const telemetry = new OtelTelemetry(
 *   trace.getTracer('my-app'),
 *   metrics.getMeter('my-app')
 * )
 * ```
 */
export interface WAKitTelemetry {
	/**
	 * Record a counter increment.
	 * @param metric dot-separated metric name (e.g. 'wakit.messages.sent')
	 * @param labels optional key-value dimension labels
	 */
	count(metric: string, value?: number, labels?: Record<string, string>): void

	/**
	 * Record a histogram observation (e.g. latency, bytes).
	 * @param metric dot-separated metric name
	 * @param value observed value
	 * @param labels optional key-value dimension labels
	 */
	record(metric: string, value: number, labels?: Record<string, string>): void

	/**
	 * Set a gauge value (e.g. current queue depth).
	 */
	gauge(metric: string, value: number, labels?: Record<string, string>): void

	/**
	 * Start a span for tracing an operation.
	 * Returns a finish function to end the span.
	 * Attributes can be set before finishing.
	 *
	 * @example
	 * ```ts
	 * const finish = telemetry.span('wakit.media.upload', { jid })
	 * try {
	 *   await upload()
	 *   finish('ok')
	 * } catch {
	 *   finish('error')
	 * }
	 * ```
	 */
	span(name: string, attributes?: Record<string, string>): (status?: 'ok' | 'error') => void
}

// ─── Standard metric names ────────────────────────────────────────────────────

/** All metric names emitted by WAKit internals. Useful for dashboards. */
export const WAKitMetrics = {
	/** Total messages received (counter) */
	MESSAGES_RECEIVED: 'wakit.messages.received',
	/** Total messages sent (counter) */
	MESSAGES_SENT: 'wakit.messages.sent',
	/** Media upload bytes (histogram) */
	MEDIA_UPLOAD_BYTES: 'wakit.media.upload.bytes',
	/** Media download bytes (histogram) */
	MEDIA_DOWNLOAD_BYTES: 'wakit.media.download.bytes',
	/** Signal decrypt latency in ms (histogram) */
	SIGNAL_DECRYPT_MS: 'wakit.signal.decrypt.ms',
	/** Event buffer size at flush time (histogram) */
	EVENT_BUFFER_SIZE: 'wakit.event.buffer.size',
	/** Total reconnect attempts (counter) */
	RECONNECT_COUNT: 'wakit.reconnect.count',
	/** Circuit breaker state changes (counter, label: circuit, state) */
	CIRCUIT_BREAKER_TRANSITION: 'wakit.circuit_breaker.transition',
	/** Pre-key upload duration ms (histogram) */
	PREKEY_UPLOAD_MS: 'wakit.prekey.upload.ms'
} as const
