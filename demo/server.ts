import { execSync, spawn, ChildProcess } from 'child_process'
import path from 'path'
import { Client } from 'pg'
import { DEMO_PORT, BASE_URL } from './data'
import { buildNext } from '../scripts/next-build'
import { resolveDbUrl } from '../lib/db-url'

const PROJECT_ROOT = path.resolve(__dirname, '..')
const NEXT_BINARY = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'next')

let demoServer: ChildProcess | null = null
let demoDbName: string | null = null

export async function buildForDemo(): Promise<void> {
  await buildNext()
}

function databaseNameFromUrl(url: URL): string {
  return url.pathname.slice(1)
}

function urlForDatabase(sourceUrl: URL, database: string): string {
  const url = new URL(sourceUrl)
  url.pathname = `/${database}`
  return url.toString()
}

async function withClient<T>(
  connectionString: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** Postgres refuses a clone while anything is connected to the template. */
const OBJECT_IN_USE = '55006'
const CLONE_ATTEMPTS = 20

async function cloneDatabase(
  sourceUrl: URL,
  sourceDbName: string,
  targetDbName: string,
): Promise<void> {
  const serverUrl = urlForDatabase(sourceUrl, 'postgres')
  await withClient(serverUrl, (client) =>
    client.query(`DROP DATABASE IF EXISTS "${targetDbName}" WITH (FORCE)`),
  )
  for (let attempt = 1; ; attempt++) {
    try {
      await withClient(serverUrl, (client) =>
        client.query(`CREATE DATABASE "${targetDbName}" TEMPLATE "${sourceDbName}"`),
      )
      return
    } catch (e) {
      if ((e as { code?: string }).code !== OBJECT_IN_USE || attempt === CLONE_ATTEMPTS) throw e
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
    }
  }
}

/** Starts the server immediately (non-blocking). Returns a Promise that resolves when the server is healthy. */
export function startDemoServer(flowName: string): Promise<void> {
  return (async () => {
    const sourceUrl = new URL(resolveDbUrl())
    const sourceDbName = databaseNameFromUrl(sourceUrl)
    demoDbName = `catalyse_demo_${flowName.replace(/[^a-zA-Z0-9_]/g, '_')}`

    await cloneDatabase(sourceUrl, sourceDbName, demoDbName)
    const demoDbUrl = urlForDatabase(sourceUrl, demoDbName)

    try {
      execSync(`lsof -ti :${DEMO_PORT} | xargs kill -TERM 2>/dev/null || true`, {
        shell: '/bin/sh',
      })
    } catch {
      /* nothing listening */
    }

    demoServer = spawn(NEXT_BINARY, ['start', '-p', String(DEMO_PORT)], {
      env: {
        ...process.env,
        PORT: String(DEMO_PORT),
        DATABASE_URL: demoDbUrl,
        STUB_EMAIL: 'true',
        // Refused in a production deployment (lib/env.ts); marks this production build as
        // a local harness so startup validation lets the stub flags through.
        E2E: '1',
      },
      cwd: PROJECT_ROOT,
      detached: false,
      stdio: 'inherit',
    })

    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${BASE_URL}/api/health`)
        if (r.ok) return
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error('Demo server did not become ready within 60s')
  })()
}

export function stopDemoServer(): void {
  if (demoServer) {
    demoServer.kill('SIGTERM')
    demoServer = null
  }
  try {
    execSync(`lsof -ti :${DEMO_PORT} | xargs kill -TERM 2>/dev/null || true`, { shell: '/bin/sh' })
  } catch {
    /* ignore */
  }
  if (demoDbName) {
    const name = demoDbName
    demoDbName = null
    const sourceUrl = new URL(resolveDbUrl())
    const serverUrl = urlForDatabase(sourceUrl, 'postgres')
    withClient(serverUrl, (client) =>
      client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
    ).catch(() => {
      /* best effort cleanup */
    })
  }
}
