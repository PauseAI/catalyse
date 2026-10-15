import { chromium, FullConfig } from '@playwright/test'
import { execSync } from 'child_process'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import {
  IS_LOCAL,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  BASE_PORT,
  workerBaseUrl,
  workerDbSchema,
  workerDbUrl,
  workerAuthFile,
  pidsFile,
} from './config'
import { Client } from 'pg'
import { buildNext } from '../scripts/next-build'
import { createApiClient } from './client'
import { resolveTestDbUrl } from '../test/pg'
import { SNAPSHOTS_ENABLED, snapshotBlock, snapshotServerCount } from './snapshots/config'

const PROJECT_ROOT = path.resolve(__dirname, '..')
const NEXT_BINARY = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'next')
const PRISMA_BINARY = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'prisma')

function killServerOnPort(port: number): void {
  try {
    execSync(`lsof -tiTCP:${port} -sTCP:LISTEN | xargs kill -TERM 2>/dev/null || true`, {
      shell: '/bin/sh',
    })
  } catch {
    // nothing listening
  }
}

const IS_DEV_MODE = process.env.E2E_DEV === '1'

// Always checked, never skipped by choice — unlike buildNext()'s cache, which silently
// skips the one thing (a real `next build`) that would ever catch the generated Prisma
// client/zod schemas drifting from prisma/schema.prisma (e.g. a new model). But `prisma
// generate` rewrites its output files unconditionally, even with no schema changes, and
// buildNext()'s freshness check treats those output files as build inputs — so calling it
// unconditionally would bump their mtime and force a full rebuild on every single test run.
// Only regenerate when schema.prisma is actually newer than the generated output.
function generatePrismaClient(): void {
  const marker = path.join(PROJECT_ROOT, 'generated', 'prisma', 'client.ts')
  const schema = path.join(PROJECT_ROOT, 'prisma', 'schema.prisma')
  if (fs.existsSync(marker) && fs.statSync(marker).mtimeMs > fs.statSync(schema).mtimeMs) return

  execSync('npm run generate', { cwd: PROJECT_ROOT, stdio: 'pipe' })
}

async function migrateWorkerDb(parallelIndex: number): Promise<void> {
  const client = new Client({ connectionString: resolveTestDbUrl() })
  await client.connect()
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${workerDbSchema(parallelIndex)}" CASCADE`)
  } finally {
    await client.end()
  }
  execSync(`${PRISMA_BINARY} migrate deploy`, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: workerDbUrl(parallelIndex) },
    stdio: 'pipe',
  })
}

async function startWorkerNextJs(parallelIndex: number, serverCount: number): Promise<number> {
  const nextPort = BASE_PORT + parallelIndex

  killServerOnPort(nextPort)
  await migrateWorkerDb(parallelIndex)

  const nextArgs = IS_DEV_MODE
    ? ['dev', '--turbo', '-p', String(nextPort)]
    : ['start', '-p', String(nextPort)]
  const server = spawn(NEXT_BINARY, nextArgs, {
    env: {
      ...process.env,
      PORT: String(nextPort),
      DATABASE_URL: workerDbUrl(parallelIndex, serverCount),
      ADMIN_EMAILS: ADMIN_EMAIL,
      RESEND_API_KEY: '',
      STUB_EMAIL: 'true',
      STUB_GOOGLE: 'true',
      DISABLE_RATE_LIMIT: 'true',
      // These stubs are refused in a production deployment (lib/env.ts); mark this
      // production build as the test harness so startup validation lets them through.
      E2E: '1',
    },
    cwd: PROJECT_ROOT,
    detached: false,
    stdio: 'ignore',
  })

  return server.pid!
}

async function waitForServer(
  baseUrl: string,
  path = '/api/health',
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}${path}`)
      if (r.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(
    `Server at ${baseUrl}${path} did not become ready within ${timeoutMs / 1000}s. Check the build succeeded and no port conflicts exist.`,
  )
}

async function setupAdminAuth(parallelIndex: number): Promise<void> {
  const baseUrl = workerBaseUrl(parallelIndex)

  if (IS_LOCAL) {
    const api = createApiClient(baseUrl)
    const result = await api.auth.signup({
      body: {
        name: 'Test Admin',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        bio: 'e2e test bio, at least twenty characters long',
        country: 'UK',
        availabilityHoursPerWeek: 5,
        applicationMessage: 'e2e test application message',
        consentMakeProfileVisibleInDirectory: true,
        consentContactableByProjectOwners: true,
      },
    })
    if (result.status !== 200) {
      throw new Error(
        `Admin signup failed for worker ${parallelIndex}: ${JSON.stringify(result.body)}`,
      )
    }
    // Admin is granted once the listed address is confirmed; confirming while signed in
    // keeps the password the login below uses.
    const { token, emailVerificationToken } = result.body
    const verified = await createApiClient(baseUrl, token).auth.verifyEmail({
      body: { token: emailVerificationToken },
    })
    if (verified.status !== 200) {
      throw new Error(
        `Admin email confirmation failed for worker ${parallelIndex}: ${JSON.stringify(verified.body)}`,
      )
    }
  }

  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${baseUrl}/login`)
  await page.getByLabel('Email', { exact: true }).fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${baseUrl}/dashboard`)

  const authFile = workerAuthFile(parallelIndex)
  fs.mkdirSync(path.dirname(authFile), { recursive: true })
  await context.storageState({ path: authFile })

  await browser.close()
}

async function globalSetup(config: FullConfig): Promise<void> {
  // A snapshot lane owns a block of servers (see snapshotBlock); a plain run owns them all.
  const block = SNAPSHOTS_ENABLED ? snapshotBlock() : { first: 0, count: config.workers }
  const indexes = Array.from({ length: block.count }, (_, i) => block.first + i)

  if (IS_LOCAL) {
    generatePrismaClient()
    // `npm run snapshots` builds once before its lane processes start.
    if (!IS_DEV_MODE && process.env.SNAPSHOT_PREBUILT !== '1') await buildNext()

    const ports = indexes.map((i) => BASE_PORT + i)
    console.log(
      `[setup] Starting ${indexes.length} worker${indexes.length > 1 ? 's' : ''} on ports ${ports.join(', ')}`,
    )
    const pids: Record<string, number> = {}
    for (const i of indexes) {
      pids[i] = await startWorkerNextJs(i, snapshotServerCountFor(config))
    }
    fs.writeFileSync(pidsFile(block.first), JSON.stringify(pids))

    await Promise.all(indexes.map((i) => waitForServer(workerBaseUrl(i), '/api/health', 30_000)))

    await Promise.all(indexes.map((i) => setupAdminAuth(i)))
  } else {
    await setupAdminAuth(0)
    const src = workerAuthFile(0)
    for (let i = 1; i < indexes.length; i++) {
      fs.copyFileSync(src, workerAuthFile(i))
    }
  }
}

/** Servers open across the whole run, which sizes each one's connection pool. */
function snapshotServerCountFor(config: FullConfig): number {
  return SNAPSHOTS_ENABLED ? snapshotServerCount() : config.workers
}

export default globalSetup
