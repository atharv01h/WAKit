# Storage Guide

WAKit provides a pluggable storage system for authentication credentials, Signal protocol keys, chat state, and plugin data.

## Storage Adapters

| Adapter | Use Case |
|---------|----------|
| `MemoryStore` | Tests, ephemeral scripts, development |
| `JsonFileStore` | Production bots, persistent sessions |
| Custom `WAKitStore` | Any database backend |

## MemoryStore

Zero-dependency in-memory store. Data is lost when the process exits.

```ts
import { MemoryStore } from 'wakit'

const store = new MemoryStore()

// Use directly with createClient (coming soon via store option)
// or use in tests:
await store.saveCreds(creds)
const loaded = await store.loadCreds()

// Diagnostics
console.log('Signal keys:', store.signalKeyCount)
console.log('Chats:', store.chatCount)

// Clear all data
store.clear()
```

## JsonFileStore

File-system store backward compatible with `useMultiFileAuthState` directories.

```ts
import { JsonFileStore } from 'wakit'

const store = new JsonFileStore('./session')
await store.initialize() // creates directory if needed

// Reads existing wakit_auth_info/ directories
const existingStore = new JsonFileStore('./wakit_auth_info')
await existingStore.initialize()

// Use for auth state (compatible with makeWASocket)
const creds = await store.loadCreds()
```

## Implementing a Custom Store

```ts
import type { WAKitStore } from 'wakit'
import type { AuthenticationCreds, Chat, SignalDataSet, SignalDataTypeMap } from 'wakit'

class PostgresStore implements WAKitStore {
  constructor(private db: Database) {}

  async initialize() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS wa_creds (id SERIAL PRIMARY KEY, data JSONB);
      CREATE TABLE IF NOT EXISTS wa_signal (type TEXT, id TEXT, data JSONB, PRIMARY KEY (type, id));
      CREATE TABLE IF NOT EXISTS wa_chats (jid TEXT PRIMARY KEY, data JSONB);
      CREATE TABLE IF NOT EXISTS wa_plugins (plugin TEXT, key TEXT, data JSONB, PRIMARY KEY (plugin, key));
    `)
  }

  async loadCreds(): Promise<AuthenticationCreds | null> {
    const row = await this.db.query('SELECT data FROM wa_creds LIMIT 1')
    return row.rows[0]?.data ?? null
  }

  async saveCreds(creds: AuthenticationCreds): Promise<void> {
    await this.db.query(
      'INSERT INTO wa_creds (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1',
      [creds]
    )
  }

  async getSignalData<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[]
  ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ')
    const rows = await this.db.query(
      `SELECT id, data FROM wa_signal WHERE type = $1 AND id IN (${placeholders})`,
      [type, ...ids]
    )
    const result: { [id: string]: SignalDataTypeMap[T] } = {}
    for (const row of rows.rows) {
      result[row.id] = row.data
    }
    return result
  }

  async setSignalData(data: SignalDataSet): Promise<void> {
    // Batch upsert — implementation varies by DB
    for (const type in data) {
      const typeData = data[type as keyof SignalDataTypeMap]!
      for (const id in typeData) {
        const value = typeData[id]
        if (value === null) {
          await this.db.query('DELETE FROM wa_signal WHERE type = $1 AND id = $2', [type, id])
        } else {
          await this.db.query(
            'INSERT INTO wa_signal (type, id, data) VALUES ($1, $2, $3) ON CONFLICT (type, id) DO UPDATE SET data = $3',
            [type, id, value]
          )
        }
      }
    }
  }

  async loadChats(): Promise<Chat[]> {
    const rows = await this.db.query('SELECT data FROM wa_chats')
    return rows.rows.map(r => r.data)
  }

  async saveChat(chat: Chat): Promise<void> {
    await this.db.query(
      'INSERT INTO wa_chats (jid, data) VALUES ($1, $2) ON CONFLICT (jid) DO UPDATE SET data = $2',
      [chat.id, chat]
    )
  }

  async deleteChat(jid: string): Promise<void> {
    await this.db.query('DELETE FROM wa_chats WHERE jid = $1', [jid])
  }

  async getPluginData<T>(pluginName: string, key: string): Promise<T | null> {
    const row = await this.db.query(
      'SELECT data FROM wa_plugins WHERE plugin = $1 AND key = $2',
      [pluginName, key]
    )
    return row.rows[0]?.data ?? null
  }

  async setPluginData<T>(pluginName: string, key: string, data: T): Promise<void> {
    await this.db.query(
      'INSERT INTO wa_plugins (plugin, key, data) VALUES ($1, $2, $3) ON CONFLICT (plugin, key) DO UPDATE SET data = $3',
      [pluginName, key, data]
    )
  }

  async deletePluginData(pluginName: string, key: string): Promise<void> {
    await this.db.query('DELETE FROM wa_plugins WHERE plugin = $1 AND key = $2', [pluginName, key])
  }

  async close() {
    await this.db.end()
  }
}
```

## Using a Custom Store with WAKit (makeWASocket bridge)

Until `createClient` gains a `store` option, you can use a custom store manually:

```ts
import { makeWASocket, makeCacheableSignalKeyStore } from 'wakit'
import { PostgresStore } from './postgres-store'

const store = new PostgresStore(db)
await store.initialize()

const creds = await store.loadCreds()

const sock = makeWASocket({
  auth: {
    creds: creds ?? initAuthCreds(),
    keys: makeCacheableSignalKeyStore({
      get: (type, ids) => store.getSignalData(type, ids),
      set: (data) => store.setSignalData(data)
    }, logger)
  }
})

sock.ev.on('creds.update', () => store.saveCreds(sock.authState.creds))
```

## Security Recommendations

- **Encrypt at rest**: The built-in stores write plaintext JSON. For production, encrypt the files with AES-256 or use a secrets manager.
- **Never commit session files** to git. Add `wakit_auth_info/` and `*.session` to `.gitignore`.
- **Backup regularly**: Use `wakit session backup` or set up automated snapshots.
- **Rotate credentials**: If a session is compromised, log out and re-authenticate immediately.
