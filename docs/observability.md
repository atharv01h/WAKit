# Observability Guide

WAKit includes a telemetry system for metrics, tracing, and logging.

## Default: Zero-Overhead Noop

By default, WAKit uses `NoopTelemetry` — all telemetry methods are empty functions that V8 inlines and eliminates. Zero performance impact when telemetry is not needed.

## Available Metrics

| Metric | Type | Labels |
|--------|------|--------|
| `wakit.messages.received` | counter | `dropped` |
| `wakit.messages.sent` | counter | `aborted` |
| `wakit.media.upload.bytes` | histogram | — |
| `wakit.media.download.bytes` | histogram | — |
| `wakit.signal.decrypt.ms` | histogram | — |
| `wakit.event.buffer.size` | histogram | — |
| `wakit.reconnect.count` | counter | — |
| `wakit.circuit_breaker.transition` | counter | `circuit`, `state` |
| `wakit.prekey.upload.ms` | histogram | — |

## CircuitBreaker Events

The circuit breaker emits Node.js events you can monitor:

```ts
import { CircuitBreaker } from 'wakit'

const cb = new CircuitBreaker({
  name: 'media-upload',
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeoutMs: 30_000
})

cb.on('open', ({ failures }) => {
  logger.error({ failures }, 'circuit opened — media upload unavailable')
  alerting.trigger('circuit_open', { circuit: 'media-upload' })
})

cb.on('close', () => {
  logger.info('circuit closed — media upload restored')
})

cb.on('half-open', () => {
  logger.info('circuit half-open — testing media upload')
})

cb.on('rejected', ({ name }) => {
  metrics.increment('wakit.circuit_breaker.rejected', { circuit: name })
})

// Use the circuit breaker
try {
  const result = await cb.exec(() => uploadMedia(file))
} catch (err) {
  if (err instanceof Boom && err.output.statusCode === 503) {
    console.log('Circuit open — try again later')
  }
}
```

## Custom Telemetry Implementation

Implement `WAKitTelemetry` to connect WAKit to any observability stack:

```ts
import type { WAKitTelemetry } from 'wakit'
import { metrics as otelMetrics, trace } from '@opentelemetry/api'

class OpenTelemetryProvider implements WAKitTelemetry {
  private meter = otelMetrics.getMeter('wakit')
  private tracer = trace.getTracer('wakit')
  private counters = new Map<string, ReturnType<typeof this.meter.createCounter>>()
  private histograms = new Map<string, ReturnType<typeof this.meter.createHistogram>>()
  private gauges = new Map<string, ReturnType<typeof this.meter.createObservableGauge>>()

  count(metric: string, value = 1, labels?: Record<string, string>) {
    if (!this.counters.has(metric)) {
      this.counters.set(metric, this.meter.createCounter(metric))
    }
    this.counters.get(metric)!.add(value, labels)
  }

  record(metric: string, value: number, labels?: Record<string, string>) {
    if (!this.histograms.has(metric)) {
      this.histograms.set(metric, this.meter.createHistogram(metric))
    }
    this.histograms.get(metric)!.record(value, labels)
  }

  gauge(metric: string, value: number, _labels?: Record<string, string>) {
    // Store latest gauge value for async collection
    // (OTel gauge pattern varies — simplified here)
    console.log(`[gauge] ${metric}=${value}`)
  }

  span(name: string, attributes?: Record<string, string>): (status?: 'ok' | 'error') => void {
    const span = this.tracer.startSpan(name, { attributes })
    return (status = 'ok') => {
      span.setStatus({ code: status === 'ok' ? 1 : 2 })
      span.end()
    }
  }
}
```

## Pino Structured Logging

WAKit uses Pino for all internal logging. Configure the log level:

```ts
import P from 'pino'

const client = await createClient({
  auth: './session',
  logger: P({
    level: 'info', // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  })
})
```

### Log Levels

| Level | What You See |
|-------|-------------|
| `silent` | Nothing |
| `error` | Errors only |
| `warn` | Errors + warnings |
| `info` | Normal operational events |
| `debug` | Detailed event flow |
| `trace` | Every binary node |

## Event Recording for Debugging

```ts
import { wrapEventBus } from 'wakit'

const bus = wrapEventBus(client.socket.ev)

// Start recording
const stop = bus.record()

// Reproduce the bug...

// Stop and inspect
const captured = stop()
console.log('Captured', captured.length, 'events')
console.log('Event types:', [...new Set(captured.map(e => e.event))])

// Replay recorded events
for (const entry of captured) {
  console.log(entry.timestamp.toISOString(), entry.event, entry.data)
}
```
