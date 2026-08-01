<div align="center">
  <h1>🚀 WAKit</h1>
  <p><b>The Next-Generation TypeScript WhatsApp SDK</b></p>
  
  <p>
    <a href="https://github.com/atharv01h/WAKit/actions"><img src="https://img.shields.io/github/actions/workflow/status/atharv01h/WAKit/test.yml?branch=main&style=flat-square&logo=github" alt="Build Status"></a>
    <a href="https://www.npmjs.com/package/@atharvh01/wakit"><img src="https://img.shields.io/npm/v/@atharvh01/wakit?style=flat-square&color=blue" alt="NPM Version"></a>
    <a href="https://www.npmjs.com/package/@atharvh01/wakit"><img src="https://img.shields.io/npm/dt/@atharvh01/wakit?style=flat-square&color=green" alt="NPM Downloads"></a>
    <a href="https://github.com/atharv01h/WAKit/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@atharvh01/wakit?style=flat-square&color=orange" alt="License"></a>
  </p>
</div>

---

**WAKit** is a powerful, reliable, and enterprise-ready TypeScript library for interacting with the WhatsApp Web Noise protocol. Built from the ground up for developer experience, it provides a highly extensible architecture featuring middleware pipelines, modular plugins, atomic storage systems, and advanced event routing.

If you are building WhatsApp bots, automation workflows, CRM integrations, or massive broadcast systems, WAKit provides the scalable foundation you need.

> [!NOTE]  
> **Project Status**: WAKit is currently in active development and is not yet perfect. I am continuously working to upgrade and improve the system. I hope you guys like it, and I strongly encourage everyone to do your best contributions to help make this the ultimate WhatsApp SDK!

### A Respectful Nod to Baileys
WAKit was born as an architectural evolution of the legendary [Baileys](https://github.com/WhiskeySockets/Baileys) library. I have immense respect for the Baileys creators and contributors who provided the foundational protocol reverse-engineering that made this possible. WAKit is my humble attempt to upgrade and build upon that incredible foundation to offer a new, production-grade developer experience.

> [!IMPORTANT]  
> **WAKit is dual-use software.** We strictly prohibit the use of this library for spam, stalkerware, or non-consensual data scraping. Please review our [Code of Conduct](./CODE_OF_CONDUCT.md) before building.

---

## ✨ Features

- **Object-Oriented Client Layer**: Encapsulated `WAKitClient` for clean session and lifecycle management.
- **Middleware Pipelines**: Intercept, mutate, or drop incoming and outgoing messages seamlessly (similar to Express/Koa).
- **Plugin Architecture**: Extend the core functionality by hooking into the lifecycle without modifying the base protocol logic.
- **Advanced Event Bus**: Replay events, filter event streams, and maintain local ring-buffer histories for flawless sync resilience.
- **Atomic Storage**: Ship with `JsonFileStore` and `MemoryStore` out of the box, utilizing asynchronous mutexes and batched writes to prevent state corruption during high-throughput history syncs.
- **Resilience**: Built-in Circuit Breakers and configurable retry logic.
- **Type-Safe**: 100% Strict TypeScript compliance. No arbitrary `any` casting in public APIs.

---



## 📦 Installation

WAKit requires **Node.js ≥ 20.0.0** and uses **Yarn 4** (via Corepack).

```bash
npm install @atharvh01/wakit
# or
yarn add @atharvh01/wakit
# or
pnpm add @atharvh01/wakit
```

---

## 🚀 Quickstart

Setting up a robust WhatsApp client with WAKit takes only a few lines of code.

```typescript
import { createClient, JsonFileStore, incomingLoggingMiddleware } from '@atharvh01/wakit'

async function main() {
  // 1. Initialize an atomic JSON store for session keys
  const store = new JsonFileStore('./wakit_auth_info')
  await store.initialize()

  // 2. Create the WAKit Client
  const client = await createClient({
    auth: store,
    printQRInTerminal: true,
    autoReconnect: true,
  })

  // 3. Mount Middleware (e.g., Logging, Rate Limiting)
  client.useIncoming(incomingLoggingMiddleware(client.logger))

  // 4. Listen to the Enhanced Event Bus
  client.on('connection.update', (update) => {
    const { connection, qr } = update
    if (connection === 'open') {
      console.log('✅ Connected to WhatsApp!')
    }
  })

  client.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue
      
      const jid = msg.key.remoteJid!
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text
      
      if (text === '!ping') {
        // 5. Send messages through the Outgoing Pipeline
        await client.sendMessage(jid, { text: 'pong 🏓' })
      }
    }
  })

  // 6. Connect!
  await client.connect()
}

main().catch(console.error)
```

---

## 🏗 Core Concepts

### 1. Middleware Pipelines
Modify or filter messages before they reach your business logic (incoming) or before they are sent to the WhatsApp servers (outgoing).

```typescript
import { filterJidMiddleware, rateLimitMiddleware } from '@atharvh01/wakit/Middleware/builtins'

// Drop messages from certain JIDs
client.useIncoming(filterJidMiddleware(jid => jid.includes('broadcast')))

// Apply a sliding-window rate limit (e.g. 60 messages / minute)
client.useIncoming(rateLimitMiddleware({ maxPerWindow: 60, windowMs: 60000 }))
```

### 2. Plugin Ecosystem
Encapsulate complex behavior into reusable plugins.

```typescript
import { AutoReadPlugin } from '@atharvh01/wakit/Plugins/AutoRead'

// Automatically send read receipts for incoming messages
client.registerPlugin(new AutoReadPlugin())
```

### 3. Advanced Event Bus
The `WAKitEventBus` wraps the standard emitter with ring-buffer history and filtering.

```typescript
// Replay the last 5 'messages.upsert' events instantly upon registration
client.events.replay('messages.upsert', (data) => {
  console.log('Replayed:', data)
})

// Only trigger listener if a specific condition is met
client.events.filter('connection.update', 
  (update) => update.connection === 'open',
  () => console.log('This will only fire when the connection opens!')
)
```

---

## 📖 Documentation

Detailed documentation and guides are available in the `/docs` directory:

- [Architecture Overview](./docs/architecture.md)
- [Middleware Guide](./docs/middleware.md)
- [Plugin Development](./docs/plugins.md)
- [Storage Systems](./docs/storage.md)

---

## 🤝 Contributing

We welcome contributions from the community! If you're planning to write code, please read our [Contributing Guide](CONTRIBUTING.md) and our [AGENTS.md](./AGENTS.md) if you are an AI coding assistant.

1. Fork the repository.
2. Ensure you are using Corepack (`corepack enable`) and Yarn 4.
3. Run `yarn build` and `yarn test` to verify your environment.
4. Open a Pull Request!

---

## 👨‍💻 About the Creator

**WAKit** is designed and maintained by **Atharv Hatwar** and the open-source community. 

Atharv is a software engineer passionate about developer tooling, robust systems architecture, and pushing the boundaries of what is possible in the open-source ecosystem.

🌍 **Connect with Atharv:**
- **GitHub**: [github.com/atharv01h](https://github.com/atharv01h)
- **NPM**: [npmjs.com/~atharvh01](https://www.npmjs.com/~atharvh01)
- **LinkedIn**: [linkedin.com/in/atharv-hatwar](https://www.linkedin.com/in/atharv-hatwar/)

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details. 

*Disclaimer: WAKit is not affiliated with, sponsored by, or endorsed by WhatsApp Inc. or Meta Platforms, Inc. Use this software at your own risk and ensure compliance with WhatsApp's Terms of Service.*
