import type { ILogger } from '../../Utils/logger'
import { definePlugin } from '../types'

export interface LoggerPluginOptions {
	/** The pino-compatible logger to write events to */
	logger: ILogger
	/**
	 * Which WAKit events to log. Defaults to a curated set:
	 * connection.update, messages.upsert, groups.upsert, call
	 */
	events?: Array<
		| 'connection.update'
		| 'messages.upsert'
		| 'messages.update'
		| 'groups.upsert'
		| 'group-participants.update'
		| 'call'
		| 'presence.update'
		| 'chats.upsert'
	>
}

const DEFAULT_EVENTS: NonNullable<LoggerPluginOptions['events']> = [
	'connection.update',
	'messages.upsert',
	'groups.upsert',
	'call'
]

/**
 * Built-in structured logging plugin.
 *
 * Subscribes to a configurable set of WAKit events and logs them at debug
 * level using the provided pino-compatible logger.
 *
 * @example
 * ```ts
 * import pino from 'pino'
 * import { LoggerPlugin } from 'wakit'
 *
 * const logger = pino({ level: 'debug' })
 * await client.use(LoggerPlugin({ logger }))
 * ```
 */
export function LoggerPlugin(opts: LoggerPluginOptions) {
	const events = opts.events ?? DEFAULT_EVENTS
	const logger = opts.logger

	return definePlugin({
		name: 'wakit-logger-plugin',
		version: '1.0.0',
		author: 'Atharv Hatwar',
		description: 'Structured event logging plugin for WAKit',
		permissions: ['messages:read'],

		async install(client) {
			if (events.includes('connection.update')) {
				client.on('connection.update', update => {
					logger.debug({ update }, 'wakit: connection.update')
				})
			}

			if (events.includes('messages.upsert')) {
				client.on('messages.upsert', ({ messages, type }) => {
					logger.debug({ type, count: messages.length, first: messages[0]?.key?.id }, 'wakit: messages.upsert')
				})
			}

			if (events.includes('messages.update')) {
				client.on('messages.update', updates => {
					logger.debug({ count: updates.length }, 'wakit: messages.update')
				})
			}

			if (events.includes('groups.upsert')) {
				client.on('groups.upsert', groups => {
					logger.debug({ count: groups.length }, 'wakit: groups.upsert')
				})
			}

			if (events.includes('group-participants.update')) {
				client.on('group-participants.update', update => {
					logger.debug({ groupId: update.id, action: update.action }, 'wakit: group-participants.update')
				})
			}

			if (events.includes('call')) {
				client.on('call', calls => {
					logger.debug({ count: calls.length }, 'wakit: call')
				})
			}

			if (events.includes('presence.update')) {
				client.on('presence.update', ({ id }) => {
					logger.debug({ id }, 'wakit: presence.update')
				})
			}

			if (events.includes('chats.upsert')) {
				client.on('chats.upsert', chats => {
					logger.debug({ count: chats.length }, 'wakit: chats.upsert')
				})
			}

			logger.debug({ events }, 'wakit-logger-plugin: installed')
		}
	})
}
