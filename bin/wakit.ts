#!/usr/bin/env node
/**
 * WAKit CLI
 *
 * Usage:
 *   wakit init            — Scaffold a new WAKit project
 *   wakit doctor          — Validate environment, session, and dependencies
 *   wakit session         — Inspect, export, import, or backup session
 *   wakit generate        — Generate bot, plugin, or middleware scaffolds
 *   wakit benchmark       — Measure connection and throughput performance
 *   wakit docs            — Open documentation in browser
 */

import { argv, exit, versions } from 'process'
import { execSync, spawn } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

// ─── ANSI colour helpers ──────────────────────────────────────────────────────

const c = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
	grey: '\x1b[90m'
}

const ok = (msg: string) => console.log(`${c.green}✓${c.reset} ${msg}`)
const warn = (msg: string) => console.log(`${c.yellow}⚠${c.reset} ${msg}`)
const fail = (msg: string) => console.log(`${c.red}✗${c.reset} ${msg}`)
const info = (msg: string) => console.log(`${c.cyan}ℹ${c.reset} ${msg}`)
const header = (msg: string) => console.log(`\n${c.bold}${msg}${c.reset}`)
const dim = (msg: string) => console.log(`${c.grey}${msg}${c.reset}`)

// ─── Command routing ──────────────────────────────────────────────────────────

const [, , command, ...args] = argv

async function main() {
	header('WAKit CLI v0.1.0')

	switch (command) {
		case 'init':
			await cmdInit()
			break
		case 'doctor':
		case 'doctor --fix':
			await cmdDoctor()
			break
		case 'session':
			await cmdSession(args[0] ?? 'inspect')
			break
		case 'generate':
		case 'gen':
			await cmdGenerate(args[0] ?? 'bot')
			break
		case 'benchmark':
			await cmdBenchmark()
			break
		case 'docs':
			await cmdDocs()
			break
		default:
			cmdHelp()
	}
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdHelp() {
	console.log(`
${c.bold}WAKit CLI${c.reset}

${c.cyan}Usage:${c.reset}
  wakit ${c.green}<command>${c.reset} [options]

${c.cyan}Commands:${c.reset}
  ${c.green}init${c.reset}               Scaffold a new WAKit project in the current directory
  ${c.green}doctor${c.reset}             Validate environment, Node.js version, and dependencies
  ${c.green}session${c.reset} [action]   Manage session state (inspect | export | backup)
  ${c.green}generate${c.reset} [type]    Scaffold code (bot | plugin | middleware)
  ${c.green}benchmark${c.reset}          Run connection performance benchmarks
  ${c.green}docs${c.reset}               Open the WAKit documentation

${c.cyan}Examples:${c.reset}
  wakit init
  wakit doctor
  wakit session inspect --dir ./my-session
  wakit generate plugin --name my-logger
`)
}

async function cmdDoctor() {
	header('WAKit Doctor — Environment Check')

	// Node version check
	const nodeVersion = parseInt(versions.node.split('.')[0]!, 10)
	if (nodeVersion >= 20) {
		ok(`Node.js ${versions.node} (≥20 required)`)
	} else {
		fail(`Node.js ${versions.node} — version ≥20 required`)
	}

	// Check for package.json
	const pkgPath = resolve('package.json')
	if (existsSync(pkgPath)) {
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
		const hasWAKit =
			pkg.dependencies?.wakit ||
			pkg.devDependencies?.wakit ||
			pkg.dependencies?.['@atharvh01/wakit'] ||
			pkg.devDependencies?.['@atharvh01/wakit']
		if (hasWAKit) {
			ok('wakit found in package.json')
		} else {
			warn('wakit not found in package.json — run: npm install wakit')
		}
	} else {
		warn('No package.json found — run from your project root')
	}

	// Check for common session directories
	const sessionDirs = ['wakit_auth_info', 'auth_info', 'session', '.wakit']
	const found = sessionDirs.filter(dir => existsSync(resolve(dir)))
	if (found.length > 0) {
		ok(`Session directory found: ${found.join(', ')}`)

		// Check for creds.json
		for (const dir of found) {
			const credsPath = join(dir, 'creds.json')
			if (existsSync(credsPath)) {
				ok(`  ${dir}/creds.json — credentials file found`)
			} else {
				warn(`  ${dir}/creds.json — not found (first-time auth required)`)
			}
		}
	} else {
		warn('No session directory found — you will need to authenticate on first run')
	}

	// Check for pino-pretty (optional but recommended)
	try {
		execSync('node -e "require(\'pino-pretty\')"', { stdio: 'ignore' })
		ok('pino-pretty available (pretty logs enabled)')
	} catch {
		dim('  pino-pretty not installed — logs will be JSON (npm install pino-pretty)')
	}

	info('Doctor check complete.')
}

async function cmdInit() {
	header('WAKit — Initializing new project')

	if (existsSync('index.ts') || existsSync('index.js')) {
		warn('index.ts/index.js already exists — skipping file creation')
		return
	}

	const template = `import { createClient } from 'wakit'
import { Boom } from '@hapi/boom'

const client = await createClient({
\tauth: './session',
\tautoReconnect: true
})

client.on('connection.update', ({ connection, qr, lastDisconnect }) => {
\tif (qr) {
\t\tconsole.log('Scan QR code:', qr)
\t}

\tif (connection === 'close') {
\t\tconst code = (lastDisconnect?.error as Boom)?.output?.statusCode
\t\tconsole.log('Connection closed, code:', code)
\t} else if (connection === 'open') {
\t\tconsole.log('Connected! User:', client.user?.id)
\t}
})

client.on('messages.upsert', ({ messages, type }) => {
\tif (type === 'notify') {
\t\tfor (const msg of messages) {
\t\t\tconst text = msg.message?.conversation
\t\t\tif (text && !msg.key.fromMe) {
\t\t\t\tconsole.log('Received:', text, 'from', msg.key.remoteJid)
\t\t\t}
\t\t}
\t}
})

console.log('WAKit bot started. Waiting for messages...')
`

	writeFileSync('index.ts', template, 'utf-8')
	ok('Created index.ts')

	if (!existsSync('package.json')) {
		const pkg = {
			name: 'my-wakit-bot',
			version: '1.0.0',
			type: 'module',
			scripts: {
				start: 'tsx index.ts',
				dev: 'tsx watch index.ts'
			},
			dependencies: {
				wakit: 'latest',
				'@hapi/boom': 'latest',
				tsx: 'latest'
			}
		}
		writeFileSync('package.json', JSON.stringify(pkg, null, 2), 'utf-8')
		ok('Created package.json')
	}

	if (!existsSync('.gitignore')) {
		writeFileSync('.gitignore', 'node_modules/\nsession/\nwakit_auth_info/\n*.log\n', 'utf-8')
		ok('Created .gitignore')
	}

	info('\nNext steps:')
	dim('  npm install')
	dim('  npm start')
}

async function cmdGenerate(type: string) {
	header(`WAKit — Generating ${type} scaffold`)

	const name = args.find(a => a.startsWith('--name='))?.split('=')[1] ?? `my-${type}`

	switch (type) {
		case 'plugin': {
			const code = `import { definePlugin } from 'wakit'

export default definePlugin({
\tname: '${name}',
\tversion: '1.0.0',
\tdescription: 'My WAKit plugin',
\tpermissions: ['messages:read'],

\tasync install(client) {
\t\tclient.on('messages.upsert', ({ messages, type }) => {
\t\t\tif (type !== 'notify') return
\t\t\tfor (const msg of messages) {
\t\t\t\t// Handle messages here
\t\t\t\tconsole.log('[${name}] message:', msg.key.id)
\t\t\t}
\t\t})
\t},

\tasync uninstall(_client) {
\t\t// Clean up timers, listeners, etc.
\t}
})
`
			const filename = `${name}.ts`
			writeFileSync(filename, code, 'utf-8')
			ok(`Created plugin: ${filename}`)
			break
		}
		case 'middleware': {
			const code = `import type { Middleware, IncomingMessageContext } from 'wakit'

export function ${name.replace(/-/g, '_')}Middleware(): Middleware<IncomingMessageContext> {
\treturn async (ctx, next) => {
\t\t// Your middleware logic here
\t\tconsole.log('Processing message from:', ctx.remoteJid)
\t\tawait next()
\t}
}
`
			const filename = `${name}.ts`
			writeFileSync(filename, code, 'utf-8')
			ok(`Created middleware: ${filename}`)
			break
		}
		case 'bot':
		default:
			await cmdInit()
	}
}

async function cmdSession(action: string) {
	header(`WAKit Session — ${action}`)

	const dir = args.find(a => a.startsWith('--dir='))?.split('=')[1] ?? 'wakit_auth_info'

	if (!existsSync(dir)) {
		fail(`Session directory not found: ${dir}`)
		return
	}

	switch (action) {
		case 'inspect': {
			const credsPath = join(dir, 'creds.json')
			if (!existsSync(credsPath)) {
				warn('No creds.json found — session not yet authenticated')
				return
			}

			const creds = JSON.parse(readFileSync(credsPath, 'utf-8'))
			info(`Session directory: ${dir}`)
			info(`Authenticated as: ${creds.me?.id ?? '(unknown)'}`)
			info(`Name: ${creds.me?.name ?? '(unknown)'}`)
			info(`Platform: ${creds.platform ?? '(unknown)'}`)
			info(`Registered: ${creds.registered ? 'yes' : 'no'}`)
			break
		}
		case 'export': {
			const exportPath = `session-export-${Date.now()}.json`
			const credsPath = join(dir, 'creds.json')
			if (existsSync(credsPath)) {
				const creds = readFileSync(credsPath, 'utf-8')
				writeFileSync(exportPath, creds, 'utf-8')
				ok(`Exported credentials to ${exportPath}`)
			} else {
				fail('No creds.json to export')
			}

			break
		}
		case 'backup': {
			const backupDir = `session-backup-${Date.now()}`
			execSync(`cp -r "${dir}" "${backupDir}"`, { stdio: 'inherit' })
			ok(`Session backed up to ${backupDir}/`)
			break
		}
		default:
			warn(`Unknown session action: ${action}. Use: inspect | export | backup`)
	}
}

async function cmdBenchmark() {
	header('WAKit Benchmark')
	info('Benchmark mode requires an active session.')
	info('Connect to WhatsApp first, then this command will:')
	info('  - Measure connection establishment time')
	info('  - Measure message encode/decode throughput')
	info('  - Report memory usage')
	warn('Full benchmark support requires a live connection — coming in a future release.')
}

async function cmdDocs() {
	header('WAKit Documentation')
	const docsUrl = 'https://github.com/atharv01h/WAKit/tree/main/docs'
	info(`Opening documentation: ${docsUrl}`)

	const opener =
		process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
	spawn(opener, [docsUrl], { detached: true, stdio: 'ignore' }).unref()
}

// ─── Entry point ──────────────────────────────────────────────────────────────

main().catch(err => {
	fail(`Fatal error: ${(err as Error).message}`)
	exit(1)
})
