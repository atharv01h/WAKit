# Middleware Guide

WAKit's middleware system lets you intercept and transform messages as they flow in and out of the socket. Inspired by Koa and Express, it uses a composable pipeline with `async (ctx, next) => {}` handlers.

## How It Works

Middleware runs in registration order. Each handler receives a context object and a `next()` function. Call `next()` to pass control to the subsequent middleware. Skip `next()` to short-circuit the pipeline.

```
┌─────────────────────────────────────────────────────┐
│           Incoming Message Pipeline                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Logging  │→ │Rate Limit│→ │  Your Business   │  │
│  │          │  │          │  │     Logic        │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Built-in Middleware

### Logging

```ts
import { createClient, incomingLoggingMiddleware } from 'wakit'
import P from 'pino'

const logger = P({ level: 'debug' })
const client = await createClient({ auth: './session', logger })

client.useIncoming(incomingLoggingMiddleware(logger))
// Logs: { jid, msgId, fromMe, dropped, durationMs }
```

### Rate Limiting

```ts
import { rateLimitMiddleware } from 'wakit'

client.useIncoming(rateLimitMiddleware({
  maxPerWindow: 30,     // max 30 messages
  windowMs: 60_000,     // per minute
  onLimitExceeded: (ctx) => {
    console.warn('Rate limit hit for', ctx.remoteJid)
  }
}))
```

### JID Filtering

```ts
import { filterJidMiddleware, isJidBroadcast } from 'wakit'

// Drop all broadcast messages
client.useIncoming(filterJidMiddleware(isJidBroadcast))

// Drop messages from specific JID
client.useIncoming(filterJidMiddleware(jid => jid === 'spam@s.whatsapp.net'))
```

### Metrics

```ts
import { incomingMetricsMiddleware } from 'wakit'

const myCollector = {
  increment: (metric, labels) => console.log(metric, labels),
  timing: (metric, ms) => console.log(metric, ms)
}

client.useIncoming(incomingMetricsMiddleware(myCollector))
```

## Custom Middleware

### Incoming message middleware

```ts
import type { Middleware, IncomingMessageContext } from 'wakit'

const myMiddleware: Middleware<IncomingMessageContext> = async (ctx, next) => {
  // ctx.message   — the WAMessage
  // ctx.remoteJid — sender JID
  // ctx.drop      — set to true to drop this message
  // ctx.meta      — arbitrary metadata bag

  if (ctx.message.message?.conversation?.includes('spam')) {
    ctx.drop = true
    return // don't call next
  }

  // Attach metadata for subsequent middleware
  ctx.meta.processedAt = Date.now()

  await next()

  // Code here runs after all downstream middleware
  console.log('Processing took:', Date.now() - (ctx.meta.processedAt as number), 'ms')
}

client.useIncoming(myMiddleware)
```

### Outgoing message middleware

```ts
import type { Middleware, OutgoingMessageContext } from 'wakit'

const attachSignatureMiddleware: Middleware<OutgoingMessageContext> = async (ctx, next) => {
  // Append signature to all outgoing text messages
  if (typeof ctx.content === 'object' && 'text' in ctx.content && ctx.content.text) {
    ctx.content = {
      ...ctx.content,
      text: ctx.content.text + '\n\n— Sent via WAKit'
    }
  }

  await next()
}

client.useOutgoing(attachSignatureMiddleware)
```

### Abort an outgoing message

```ts
const rateLimitOutgoing: Middleware<OutgoingMessageContext> = async (ctx, next) => {
  if (isOverLimit(ctx.jid)) {
    ctx.abort = true
    return // don't call next, message is cancelled
  }

  await next()
}

client.useOutgoing(rateLimitOutgoing)
```

## Using createPipeline Directly

For advanced use cases, you can create a standalone pipeline:

```ts
import { createPipeline } from 'wakit'
import type { IncomingMessageContext } from 'wakit'

const pipeline = createPipeline<IncomingMessageContext>()

pipeline.use(async (ctx, next) => {
  console.log('Before')
  await next()
  console.log('After')
})

// Execute against any context
await pipeline.execute({
  message: someMessage,
  remoteJid: someJid,
  drop: false,
  meta: {}
})
```

## Middleware Execution Order

```ts
client.useIncoming(A)
client.useIncoming(B)
client.useIncoming(C)

// Execution order:
// A before → B before → C before → C after → B after → A after
```

This is the classic onion model — middleware wraps around the next handler.

## Error Handling

Errors thrown in middleware propagate up the chain. The outermost middleware (or the socket itself) will catch them:

```ts
client.useIncoming(async (ctx, next) => {
  try {
    await next()
  } catch (err) {
    console.error('Error processing message:', err)
    // Decide whether to rethrow or swallow
  }
})
```
