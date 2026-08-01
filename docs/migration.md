# Migration Guide: WAKit → WAKit

WAKit is 100% backward compatible with WAKit. You can migrate gradually — one feature at a time.

## What Changed?

Nothing was broken. WAKit adds new APIs on top of WAKit. All existing code continues to work.

## Migration Levels

### Level 0 — No Changes Required

Your existing WAKit code works as-is. Zero changes needed.

```ts
import makeWASocket from 'wakit' // still works
```

### Level 1 — Use createClient

Replace the boilerplate with `createClient`:

**Before:**
```ts
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestWAKitVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore
} from 'wakit'
import { Boom } from '@hapi/boom'
import P from 'pino'

const logger = P({ level: 'silent' })
const { state, saveCreds } = await useMultiFileAuthState('auth')
const { version } = await fetchLatestWAKitVersion()

const sock = makeWASocket({
  version,
  logger,
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger)
  }
})

sock.ev.on('creds.update', saveCreds)

sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
  if (connection === 'close') {
    const code = (lastDisconnect?.error as Boom)?.output?.statusCode
    if (code !== DisconnectReason.loggedOut) startSock()
  }
})
```

**After:**
```ts
import { createClient } from 'wakit'

const client = await createClient({ auth: './auth' })
client.on('connection.update', ({ connection }) => {
  console.log('Connection:', connection)
})
```

### Level 2 — Add Middleware

```ts
import { createClient, rateLimitMiddleware, incomingLoggingMiddleware } from 'wakit'
import P from 'pino'

const logger = P({ level: 'info' })
const client = await createClient({ auth: './auth', logger })

client.useIncoming(incomingLoggingMiddleware(logger))
client.useIncoming(rateLimitMiddleware({ maxPerWindow: 60 }))
```

### Level 3 — Add Plugins

```ts
await client.use(myAnalyticsPlugin)
await client.use(myModerationPlugin)
```

### Level 4 — Enhanced Event Bus

```ts
import { wrapEventBus } from 'wakit'

const bus = wrapEventBus(client.socket.ev, { historyCapacity: 200 })

// Replay the last 200 connection events
bus.replay('connection.update', update => {
  console.log('Previous state:', update.connection)
})

// Start recording for debug session
const stop = bus.record()
// ... do things ...
const captured = stop()
console.log('Captured:', captured.length, 'events')
```

## API Mapping

| WAKit | WAKit Equivalent |
|---------|-----------------|
| `makeWASocket(config)` | `createClient({ auth: './session' })` |
| `sock.ev.on(event, handler)` | `client.on(event, handler)` |
| `sock.ev.off(event, handler)` | `client.off(event, handler)` |
| `sock.ev.process(handler)` | `client.process(handler)` |
| `sock.sendMessage(jid, content)` | `client.sendMessage(jid, content)` |
| `sock.groupMetadata(jid)` | `client.groupMetadata(jid)` |
| `sock.onWhatsApp(number)` | `client.onWhatsApp(number)` |
| `sock.logout()` | `client.logout()` |
| `sock.requestPairingCode(phone)` | `client.requestPairingCode(phone)` |
| `sock.authState` | `client.authState` |
| `sock.user` | `client.user` |
| `sock` (raw) | `client.socket` |
| `useMultiFileAuthState(dir)` | `createClient({ auth: dir })` |

## Accessing the Raw Socket

Every WAKit API that WAKit exposes is available via `client.socket`:

```ts
const client = await createClient({ auth: './session' })

// Raw socket for advanced operations
const rawSock = client.socket

// Access all existing WAKit APIs directly
rawSock.ev.on('messages.upsert', ...)
rawSock.query({ tag: 'iq', ... })
rawSock.fetchGroupMetadata(jid)
```

## Session Directory Compatibility

WAKit's `JsonFileStore` is backward compatible with `useMultiFileAuthState` directories:

```ts
import { JsonFileStore } from 'wakit'

// Reads existing wakit_auth_info/ directories without migration
const store = new JsonFileStore('./wakit_auth_info')
await store.initialize()

const creds = await store.loadCreds() // reads existing creds.json
```
