import type { WAKitTelemetry } from './types'
/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Zero-overhead no-op telemetry implementation.
 *
 * This is the default telemetry provider used by WAKit when no other is configured.
 * All methods are empty functions, so V8 can inline-and-eliminate them entirely.
 *
 * To switch to a real telemetry provider, set `telemetry` in createClient() options.
 */
export class NoopTelemetry implements WAKitTelemetry {
	count(_metric: string, _value?: number, _labels?: Record<string, string>): void {}

	record(_metric: string, _value: number, _labels?: Record<string, string>): void {}

	gauge(_metric: string, _value: number, _labels?: Record<string, string>): void {}

	span(_name: string, _attributes?: Record<string, string>): (status?: 'ok' | 'error') => void {
		return () => {}
	}
}

/** Singleton noop telemetry instance. Import this for the default. */
export const NOOP_TELEMETRY = new NoopTelemetry()
