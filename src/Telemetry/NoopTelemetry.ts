import type { WAKitTelemetry } from './types'

/**
 * Zero-overhead no-op telemetry implementation.
 *
 * This is the default telemetry provider used by WAKit when no other is configured.
 * All methods are empty functions, so V8 can inline-and-eliminate them entirely.
 *
 * To switch to a real telemetry provider, set `telemetry` in createClient() options.
 */
export class NoopTelemetry implements WAKitTelemetry {
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	count(_metric: string, _value?: number, _labels?: Record<string, string>): void {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	record(_metric: string, _value: number, _labels?: Record<string, string>): void {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	gauge(_metric: string, _value: number, _labels?: Record<string, string>): void {}

	span(_name: string, _attributes?: Record<string, string>): (status?: 'ok' | 'error') => void {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		return () => {}
	}
}

/** Singleton noop telemetry instance. Import this for the default. */
export const NOOP_TELEMETRY = new NoopTelemetry()
