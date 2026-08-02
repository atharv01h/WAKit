# Quick Start Guide

Get from zero to a working WhatsApp bot in 2 minutes.

## Installation

```bash
npm install wakit @hapi/boom pino
```

## Zero-Config Start

```ts
import { createClient } from 'wakit'

// One line to connect
const client = await createClient({ auth: './session' })

// Listen for incoming messages
client.on('messages.upsert', ({ messages, type }) => {
  if (type === 'notify') {
    for (const msg of messages) {
      const text = msg.message?.conversation
      if (text && !msg.key.fromMe) {
        console.log(`Message from ${msg.key.remoteJid}: ${text}`)
      }
    }
  }
})

// Listen for the QR code (first-time auth)
client.on('connection.update', ({ connection, qr }) => {
  if (qr) {
    console.log('Scan QR:', qr) // or use qrcode-terminal
  }
  if (connection === 'open') {
    console.log('Connected as:', client.user?.id)
  }
})
```

> **What `createClient` does automatically:**
> - Loads/creates session credentials from `./session/`
> - Fetches the latest WhatsApp Web version
> - Auto-saves credentials on every update
> - Reconnects automatically on disconnect (exponential backoff)

## Send a Message

```ts
await client.sendMessage('1234567890@s.whatsapp.net', { text: 'Hello from WAKit!' })
```

## Send Media

```ts
// Image from file
await client.sendMessage('1234567890@s.whatsapp.net', {
  image: { url: './photo.jpg' },
  caption: 'Check this out!'
})

// Image from buffer
await client.sendMessage('1234567890@s.whatsapp.net', {
  image: Buffer.from(imageBuffer),
  caption: 'Buffered image'
})

// Audio (voice note)
await client.sendMessage('1234567890@s.whatsapp.net', {
  audio: { url: './audio.ogg' },
  mimetype: 'audio/ogg; codecs=opus',
  ptt: true
})
```

## React to a Message

```ts
await client.sendMessage('1234567890@s.whatsapp.net', {
  react: {
    text: '👍',
    key: msg.key
  }
})
```

## Check if a Number is on WhatsApp

```ts
const [result] = await client.onWhatsApp('+15551234567')
if (result?.exists) {
  console.log('JID:', result.jid)
}
```

## Pairing Code (no QR)

```ts
const client = await createClient({ auth: './session' })

client.on('connection.update', async ({ qr }) => {
  if (qr && !client.authState?.creds.registered) {
    // Use pairing code instead of QR
    const code = await client.requestPairingCode('+15551234567')
    console.log('Enter this code in WhatsApp:', code)
  }
})
```

## Using Middleware

```ts
import { createClient, rateLimitMiddleware, incomingLoggingMiddleware } from 'wakit'
import P from 'pino'

const logger = P({ level: 'debug' })
const client = await createClient({ auth: './session', logger })

// Log all incoming messages
client.useIncoming(incomingLoggingMiddleware(logger))

// Rate limit: max 10 messages per minute per JID
client.useIncoming(rateLimitMiddleware({ maxPerWindow: 10, windowMs: 60_000 }))
```

## Using Plugins

```ts
import { createClient, definePlugin } from 'wakit'

const analyticsPlugin = definePlugin({
  name: 'analytics',
  version: '1.0.0',
  async install(client) {
    let count = 0
    client.on('messages.upsert', () => count++)
    setInterval(() => console.log(`Messages this minute: ${count}`, count = 0), 60_000)
  }
})

const client = await createClient({ auth: './session' })
await client.use(analyticsPlugin)
```

## Migration from WAKit (makeWASocket)

**Before:**
```ts
import makeWASocket, { useMultiFileAuthState } from 'wakit'
const { state, saveCreds } = await useMultiFileAuthState('auth')
const sock = makeWASocket({ auth: state, ... })
sock.ev.on('creds.update', saveCreds)
sock.ev.on('connection.update', ...)
```

**After:**
```ts
import { createClient } from 'wakit'
const client = await createClient({ auth: './auth' })
client.on('connection.update', ...)
```

> **Still using makeWASocket?** It's still exported and unchanged. WAKit is fully backward compatible.

## Next Steps

- [Authentication Guide](./authentication.md) — QR, pairing code, session management
- [Middleware Guide](./middleware.md) — rate limiting, logging, validation
- [Plugin Guide](./plugins.md) — building and sharing plugins
- [Events Reference](./events.md) — all events with examples
- [CLI Reference](./cli.md) — `wakit doctor`, `wakit session`, and more
