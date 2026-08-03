<div align="center">
  <h1>WAKit</h1>
  <p><strong>A modern, powerful, and developer-friendly WebSockets library for WhatsApp Web.</strong></p>

  [![npm version](https://img.shields.io/npm/v/@atharvh01/wakit.svg)](https://www.npmjs.com/package/@atharvh01/wakit)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
</div>

> 🚧 **WAKit is currently under active development.**
> While the library is functional and highly capable, some features may still contain bugs or change before stable releases. Bug reports, feature requests, and pull requests are highly appreciated.

---

## 📑 Table of Contents
- [Introduction](#-introduction)
- [Why WAKit?](#-why-wakit)
- [What's New in WAKit](#-whats-new-in-wakit)
- [Comparison](#️-comparison)
- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Usage Examples](#-usage-examples)
- [Project Structure](#-project-structure)
- [API Overview](#-api-overview)
- [Performance](#-performance)
- [FAQ](#-faq)
- [Known Limitations](#️-known-limitations)
- [Roadmap](#️-roadmap)
- [Contributing](#-contributing)
- [License](#-license)
- [Creator](#-creator)

---

## 👋 Introduction

**WAKit** is a complete typescript-based WebSockets client for the WhatsApp Web protocol. It speaks the binary Noise/protobuf protocol directly—meaning there are no heavy browser automation tools like Puppeteer or Selenium required. 

Originally built as a modern evolution of the popular Baileys library, WAKit takes the heavy lifting out of WhatsApp automation by providing a radically simplified API, robust plugin architecture, and enterprise-grade middleware pipelines.

Whether you are building simple chat bots, complex customer support tools, or advanced integrations, WAKit provides a clean, predictable, and highly scalable foundation.

---

## 🚀 Why WAKit?

WAKit was born out of a need for better developer ergonomics. While traditional libraries give you raw access to the protocol, they often leave you to handle complex state management, reconnection logic, and event routing yourself. 

WAKit introduces:
- **Better Developer Experience:** A highly abstracted `createClient` API that hides boilerplate.
- **Cleaner APIs:** Say goodbye to deeply nested configuration objects and sprawling event listeners.
- **Easier Onboarding:** Start sending messages in less than 5 lines of code.
- **Better Organization:** Dedicated modules for Middleware, Plugins, Storage, and Telemetry.

---

## 🎨 WAKit Studio

**WAKit Studio** is a beautiful, stateless, node-based visual builder for creating WAKit bots! 

Say goodbye to manually writing complex conversational routing logic. With WAKit Studio, you can drag and drop nodes, connect triggers to actions, simulate conversations live, and instantly **export a fully functional Node.js bot project** in a single click.

- **Live Demo**: [wakitstudio.netlify.app](https://wakitstudio.netlify.app/)
- **Source Code**: [github.com/atharv01h/WAKit-Studio](https://github.com/atharv01h/WAKit-Studio)

---

## ✨ What's New in WAKit

WAKit introduces several next-generation architectural improvements over standard clients:

- **Next-Gen `WAKitClient`:** A unified client wrapper (`createClient`) that handles authentication and socket lifecycle automatically.
- **Middleware Pipeline:** Intercept, modify, rate-limit, and log incoming and outgoing messages seamlessly. Includes built-in `dedupMiddleware`, `rateLimitMiddleware`, and group-scoped pipelines.
- **Plugin System (`definePlugin`):** A robust lifecycle system (`initialize`, `install`, `ready`, `destroy`) with dependency checking. Includes built-in `LoggerPlugin` and `WebhookPlugin`.
- **REST API Generator:** Expose WAKit via an Express server dynamically. Includes API key auth, rate-limiting, and an auto-generated Swagger UI (`/docs`) and OpenAPI 3.1 spec.
- **Job Scheduler:** A `node-cron` powered task runner attached directly to the client. Schedule recurring jobs, one-shot WhatsApp message sends, and persist job state across restarts.
- **Event Recorder & Replay:** Log every socket event to disk and replay them offline at varying speeds (or step-by-step) for ultimate debugging without needing a live device connection.
- **Pluggable Storage:** Native `MemoryStore` and `JsonFileStore` for managing authentication credentials.

---

## ⚖️ Comparison

| Feature | Baileys | WAKit |
|----------|----------|--------|
| JavaScript Support | ✅ | ✅ |
| TypeScript Support | ✅ | ✅ |
| Developer Experience | Good | **Excellent** |
| API Simplicity | Low-level socket | **High-level Client** |
| Plugin Ecosystem | ❌ | ✅ **Native Plugin Registry** |
| Message Middleware | ❌ | ✅ **Native Pipeline** |
| Code Organization | Monolithic | **Modular Domain Driven** |
| Storage Adapters | Manual implementation | **Built-in `JsonFileStore` & `MemoryStore`** |
| Rate Limiting | Bring-your-own | **Built-in Middleware** |
| Learning Curve | Steep | **Beginner Friendly** |

---

## 🛠 Features

- **Direct Protocol Communication:** Fast, lightweight WebSocket connections without browsers.
- **Multi-Device Support:** Full compatibility with the latest WhatsApp Multi-Device architecture.
- **Rich Message Support:** Send text, images, videos, documents, audio, and contacts.
- **Interactive Messages:** Full support for polls and reactions.
- **Authentication:** QR code generation and 8-digit Pairing Code support.
- **Group Management:** Create groups, update metadata, manage admins, and handle invites.
- **Next-Gen Abstractions:** Middleware, Plugins, Event Bus, and Circuit Breakers.

---

## 📦 Installation

WAKit requires **Node.js ≥ 20.0.0**.

Using your favorite package manager:

```bash
npm install @atharvh01/wakit
```

```bash
yarn add @atharvh01/wakit
```

```bash
pnpm add @atharvh01/wakit
```

```bash
bun add @atharvh01/wakit
```

---

## ⚡ Quick Start

Get your bot up and running in under a minute using the new `createClient` API:

```typescript
import { createClient } from '@atharvh01/wakit';

async function start() {
    // Automatically creates/loads auth state from the provided directory
    const client = await createClient({ auth: './my-auth-session' });

    // Listen for incoming messages
    client.on('messages.upsert', async (event) => {
        const msg = event.messages[0];
        
        // Ignore messages from ourselves
        if (msg.key.fromMe) return;

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

        if (text === 'ping') {
            await client.sendMessage(msg.key.remoteJid!, { text: 'pong!' });
        }
    });
}

start();
```

*(Note: The first time you run this, a QR code will be printed to your console. Scan it with your WhatsApp mobile app to link the device.)*

---

## 📘 Usage Examples

<details>
<summary><strong>Authentication via Pairing Code (No QR)</strong></summary>

```typescript
import { createClient } from '@atharvh01/wakit';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve));

const client = await createClient({ auth: './pairing-session' });

// Request code if not registered
if (!client.authState.creds.registered) {
    const phoneNumber = await question('Please enter your phone number (e.g. 1234567890):\n');
    const code = await client.requestPairingCode(phoneNumber);
    console.log(`Your pairing code is: ${code}`);
}
```
</details>

<details>
<summary><strong>Using Middleware (Rate Limiting)</strong></summary>

```typescript
import { createClient, rateLimitMiddleware } from '@atharvh01/wakit';

const client = await createClient({ auth: './session' });

// Limit incoming messages to 10 per minute per JID
client.useIncoming(rateLimitMiddleware({ maxPerWindow: 10, windowMs: 60_000 }));
```
</details>

<details>
<summary><strong>Writing a Custom Plugin</strong></summary>

```typescript
import { createClient, definePlugin } from '@atharvh01/wakit';

const helloPlugin = definePlugin({
    name: 'hello-world',
    version: '1.0.0',
    async install(client) {
        client.on('messages.upsert', async (event) => {
            console.log(`Received message from ${event.messages[0].key.remoteJid}`);
        });
    }
});

const client = await createClient({ auth: './session' });
await client.use(helloPlugin);
```
</details>

<details>
<summary><strong>Legacy Compatibility (makeWASocket)</strong></summary>
If you are migrating from Baileys, the original `makeWASocket` API is still fully exported and backward compatible!

```typescript
import makeWASocket, { useMultiFileAuthState } from '@atharvh01/wakit';

const { state, saveCreds } = await useMultiFileAuthState('auth');
const sock = makeWASocket({ auth: state });

sock.ev.on('creds.update', saveCreds);
```
</details>

---

## 📂 Project Structure

```
WAKit/
 ├── src/
 │   ├── client/       # Next-gen WAKitClient wrapper
 │   ├── Middleware/   # Interceptors, rate limiters, logging pipelines
 │   ├── Plugins/      # Plugin registry and ecosystem logic
 │   ├── Storage/      # MemoryStore and JsonFileStore adapters
 │   ├── Socket/       # Low-level Noise protocol and socket lifecycle
 │   ├── Utils/        # Decoders, Crypto, Circuit Breakers, Event Bus
 │   └── WAProto/      # Generated Protobuf schemas
 └── Example/          # Reference implementations
```

---

## 🔍 API Overview

- `createClient(config)`: The modern entrypoint for WAKit. Returns a `WAKitClient`.
- `client.use(plugin)`: Register a plugin.
- `client.api.start()`: Spin up the WAKit REST API server.
- `client.scheduler.cron(...)`: Schedule background jobs or automated messages.
- `client.recorder.start()`: Begin capturing all WhatsApp events for debugging.
- `makeWASocket(config)`: The low-level socket constructor (Baileys compatible).
- `definePlugin(plugin)`: Type-safe plugin constructor.
- `createPipeline()`: Instantiates a middleware pipeline for message interception.
- `MemoryStore` / `JsonFileStore`: Implementations of `WAKitStore` for session management.

---

## ⚡ Performance

WAKit introduces robust structural enhancements to maintain performance at scale:
- **Bracket-pattern resource cleanup:** Memory leaks common in long-running socket connections have been heavily patched.
- **Native BigInt conversions:** Protobuf long decoding now utilizes native V8 `BigInt` mappings directly in `longToNumber` resulting in faster binary unmarshalling.
- **CacheStore Integration:** Signal Keys and retry counters are cached using `@cacheable/node-cache` preventing redundant disk/network I/O.

---

## ❓ FAQ

**Q: Can I use WAKit in the browser?**  
A: No. WAKit communicates directly via raw TCP/WebSockets and requires a Node.js environment (specifically for crypto and filesystem operations).

**Q: Will Baileys plugins work with WAKit?**  
A: Because WAKit retains backward compatibility with `makeWASocket`, most logic written for Baileys will drop-in perfectly. However, for future development, we recommend using WAKit's native `definePlugin` API.

**Q: Can this be used for mass messaging or spam?**  
A: Absolutely not. We do not accept or support usage whose primary purpose is to enable abuse or evade WhatsApp's anti-spam mechanisms.

---

## ⚠️ Known Limitations

- **Evolving APIs:** The next-gen APIs (`WAKitClient`, `Plugins`, `Middleware`) are actively being fleshed out. Expect minor additions and improvements over the next few releases.
- **E2E Encryption Sync:** Heavy history syncs (fetching years of old messages) can be resource-intensive during initial device linking.

---

## 🗺️ Roadmap

- [x] Complete Next-Gen `WAKitClient` wrapper.
- [x] Middleware system with named pipelines.
- [x] Plugin Registry and lifecycle.
- [x] Integrated Express REST API Generator & Swagger UI.
- [x] Event Recorder and Time-travel Replay.
- [x] Built-in Job Scheduler.
- [x] Pluggable Storage Adapters (`JsonFileStore`).
- [ ] First-class Database Adapters (PostgreSQL/Redis) natively included.


---

## 🤝 Contributing

We welcome contributions! To get started:

1. **Fork** the repository.
2. **Branch** off `main` (`git checkout -b feat/my-new-feature`).
3. Ensure all tests and linting pass (`yarn lint` & `yarn test`).
4. **Commit** using Conventional Commits.
5. Submit a **Pull Request**.

Please read `AGENTS.md` and `CODE_OF_CONDUCT.md` for our strict guidelines on code style, AI authorship, and anti-spam policies.

---

## 📄 License

This project is licensed under the **MIT License**.

---

## 👤 Creator

**Atharv Hatwar**  
*Open Source Developer*
