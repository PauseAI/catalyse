import path from 'path'
import os from 'os'
import { resolveTestDbUrl } from '../test/pg'

const _remoteBaseUrl = process.env.BASE_URL
export const IS_LOCAL = !_remoteBaseUrl || _remoteBaseUrl.startsWith('http://localhost')

export const ADMIN_EMAIL = 'admin@e2e-test.com'
export const ADMIN_PASSWORD = 'adminpassword1'

export const BASE_PORT = 4000
// Each worker is a Next server plus a browser, so half the cores is about the useful
// ceiling; never fewer than the four a CI runner gives, and at most eight so the workers'
// connection pools (see workerDbUrl) stay under Postgres's default max_connections.
// `WORKER_COUNT` (settable in .env.local) overrides it.
export const WORKER_COUNT = process.env.WORKER_COUNT
  ? parseInt(process.env.WORKER_COUNT, 10)
  : Math.min(8, Math.max(4, Math.floor(os.availableParallelism() / 2)))

export function workerBaseUrl(parallelIndex: number): string {
  if (IS_LOCAL) return `http://localhost:${BASE_PORT + parallelIndex}`
  return _remoteBaseUrl!
}

export function parallelIndexFromBaseUrl(baseUrl: string): number {
  if (!IS_LOCAL) return 0
  const port = parseInt(new URL(baseUrl).port, 10)
  return port - BASE_PORT
}

export function workerAuthFile(parallelIndex: number): string {
  return path.join(__dirname, '.auth', `admin_${parallelIndex}.json`)
}

// Each worker's app server gets its own Postgres schema, addressed through Prisma's
// `?schema=` URL parameter.
export function workerDbSchema(parallelIndex: number): string {
  return `e2e_${parallelIndex}`
}

/**
 * Connections the servers may hold between them. Postgres defaults to a
 * hundred, and a few must stay free for migrations, the tests' own direct
 * queries and whatever else is using the database.
 */
const POOL_BUDGET = 80

export function workerDbUrl(parallelIndex: number, serverCount = WORKER_COUNT): string {
  const url = new URL(resolveTestDbUrl())
  url.searchParams.set('schema', workerDbSchema(parallelIndex))
  // Each server gets its own pool, sized so the sum stays inside the budget.
  const limit = Math.max(2, Math.min(10, Math.floor(POOL_BUDGET / serverCount)))
  url.searchParams.set('connection_limit', String(limit))
  return url.toString()
}

/** Where a run records the servers it started, one file per block so lane processes never share one. */
export function pidsFile(firstIndex: number): string {
  return path.join(
    os.tmpdir(),
    firstIndex === 0 ? 'catalyse_e2e_pids.json' : `catalyse_e2e_pids_${firstIndex}.json`,
  )
}
