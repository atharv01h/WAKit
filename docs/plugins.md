# Plugin Guide

Plugins are the primary way to package and share reusable WAKit functionality. They have a defined lifecycle, declare their permissions, and support dependency management.

## What Is a Plugin?

A plugin is an object that implements the `WAKitPlugin` interface:

```ts
interface WAKitPlugin {
  name: string
  version: string
  description?: string
  requires?: string[]
  permissions?: PluginPermission[]
  install(client: WAKitClient): Promise<void>
  uninstall?(client: WAKitClient): Promise<void>
}
```

## Creating a Plugin

Use `definePlugin()` for full TypeScript IntelliSense:

```ts
import { definePlugin } from 'wakit'

export default definePlugin({
  name: '@myorg/wakit-analytics',
  version: '1.0.0',
  description: 'Tracks message volume per JID',
  permissions: ['messages:read'],

  async install(client) {
    const counts = new Map<string, number>()

    client.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        const jid = msg.key.remoteJid!
        counts.set(jid, (counts.get(jid) ?? 0) + 1)
      }
    })

    // Expose an accessor via client metadata
    ;(client as any)._analyticsGetCount = (jid: string) => counts.get(jid) ?? 0
  },

  async uninstall(_client) {
    // Clean up any timers or external connections
  }
})
```

## Installing a Plugin

```ts
import { createClient } from 'wakit'
import myPlugin from './my-plugin'

const client = await createClient({ auth: './session' })
await client.use(myPlugin)
```

Plugins are installed in the order you call `.use()`. Dependencies declared in `requires` must already be installed.

## Plugin Dependencies

```ts
const basePlugin = definePlugin({
  name: 'base-plugin',
  version: '1.0.0',
  async install(client) { /* ... */ }
})

const derivedPlugin = definePlugin({
  name: 'derived-plugin',
  version: '1.0.0',
  requires: ['base-plugin'], // will fail if base-plugin is not installed first
  async install(client) { /* ... */ }
})

await client.use(basePlugin)
await client.use(derivedPlugin) // ✓
```

## Plugin Permissions

Permissions are declarative documentation — they communicate what the plugin does to users and future tooling:

| Permission | Meaning |
|------------|---------|
| `messages:read` | Listens to incoming messages |
| `messages:write` | Sends messages |
| `contacts:read` | Reads contact info |
| `groups:read` | Reads group metadata |
| `groups:write` | Modifies groups |
| `media:read` | Downloads media |
| `media:write` | Uploads media |
| `presence:write` | Updates presence status |
| `socket:raw` | Accesses the raw socket |

## Plugin Diagnostics

```ts
// Get info about all installed plugins
const registry = client['_plugins'] // internal — better exposed in future versions
const diag = registry.diagnostics()
// [{ name, version, state, installedAt }]
```

## Example Plugins

### Auto-Reply Bot

```ts
export default definePlugin({
  name: 'auto-reply',
  version: '1.0.0',
  permissions: ['messages:read', 'messages:write'],

  async install(client) {
    client.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return

      for (const msg of messages) {
        if (msg.key.fromMe) continue
        const text = msg.message?.conversation
        if (!text) continue

        await client.sendMessage(msg.key.remoteJid!, {
          text: `Echo: ${text}`,
          quoted: msg
        })
      }
    })
  }
})
```

### Presence Announcer

```ts
export default definePlugin({
  name: 'presence-announcer',
  version: '1.0.0',
  permissions: ['presence:write'],

  async install(client) {
    client.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.key.remoteJid) {
          // Show typing indicator while "processing"
          await client.sendPresenceUpdate('composing', msg.key.remoteJid)
          await new Promise(r => setTimeout(r, 1000))
          await client.sendPresenceUpdate('paused', msg.key.remoteJid)
        }
      }
    })
  }
})
```

### Group Watchdog

```ts
export default definePlugin({
  name: 'group-watchdog',
  version: '1.0.0',
  permissions: ['groups:read'],

  async install(client) {
    client.on('group-participants.update', ({ id, participants, action }) => {
      console.log(`Group ${id}: ${action} → ${participants.join(', ')}`)
    })
  }
})
```

## Packaging and Sharing

A WAKit plugin is just an npm package that exports a default `WAKitPlugin` object:

```json
{
  "name": "@myorg/wakit-analytics",
  "version": "1.0.0",
  "main": "dist/index.js",
  "peerDependencies": {
    "wakit": ">=6"
  }
}
```

Users install it with:
```bash
npm install @myorg/wakit-analytics
```

And use it with:
```ts
import analyticsPlugin from '@myorg/wakit-analytics'
await client.use(analyticsPlugin)
```
