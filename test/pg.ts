import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
// Imported for its side effect of loading .env and .env.local, so the variables below can live there.
import '../lib/db-url'
import { markDisposable } from '../scripts/disposable-db'

/**
 * Every test file gets its own private copy of the schema, in one of two ways chosen by
 * `TEST_DB_MODE` (settable in .env.local):
 *
 * - `clone`: global setup migrates one template database and each file clones it with
 *   `CREATE DATABASE ... TEMPLATE`, copying files instead of replaying SQL. Needs CREATEDB.
 * - `schema`: each file creates a schema in the server's database and replays the migration
 *   SQL into it. Needs no privilege beyond the database itself.
 *
 * Cloning pays off only when the server skips fsync, as `db-test` does: with durability on
 * the two take about the same time. So unless `TEST_DB_MODE` says otherwise, a run clones when
 * `TEST_DATABASE_URL` names a dedicated server and replays into schemas when it does not.
 * `TEST_DATABASE_URL` points the suite at a throwaway server (see docker-compose.yml) so it
 * never shares one with development data; without it the suite uses `DATABASE_URL`.
 *
 * These helpers read the server's URL from the environment, never from `lib/db-url`, whose
 * `resolveDbUrl` is pointed at the file's own copy once `setup-db.ts` has run.
 */
export const DB_PREFIX = 'vitest_'

export type TestDbMode = 'clone' | 'schema'

const TEMPLATE_DB = `${DB_PREFIX}template`
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'prisma', 'migrations')

/** Postgres refuses a clone while anything, even autovacuum, is connected to the template. */
const OBJECT_IN_USE = '55006'
const CLONE_ATTEMPTS = 20
const DEADLOCK_DETECTED = '40P01'
const DROP_ATTEMPTS = 5

/** An explicit `TEST_DB_MODE` wins; otherwise cloning is used only on a dedicated test server. */
export function testDbMode(): TestDbMode {
  const mode = process.env.TEST_DB_MODE
  if (mode === 'clone' || mode === 'schema') return mode
  return process.env.TEST_DATABASE_URL ? 'clone' : 'schema'
}

export function resolveTestDbUrl(): string {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

export function migrationSql(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((dir) => fs.readFileSync(path.join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'))
    .join('\n')
}

function urlForDatabase(database: string): URL {
  const url = new URL(resolveTestDbUrl())
  url.pathname = `/${database}`
  return url
}

/** The URL Prisma is given for the private copy called `name`. */
export function testUrl(name: string): string {
  let url: URL
  if (testDbMode() === 'clone') {
    url = urlForDatabase(name)
    url.searchParams.set('schema', 'public')
  } else {
    url = new URL(resolveTestDbUrl())
    url.searchParams.set('schema', name)
  }
  // Prisma's default pool is 2 × cores + 1 per client; with a worker per core that overruns
  // Postgres's default max_connections on a large machine. Test files are mostly sequential.
  url.searchParams.set('connection_limit', '3')
  return url.toString()
}

async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString })
  await client.connect()
  return client
}

/** Runs against the server's own database, from which databases are created and dropped. */
export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect(resolveTestDbUrl())
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function createSchema(schema: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    await client.query(migrationSql())
  })
}

async function createTemplate(): Promise<void> {
  await withClient((client) => client.query(`CREATE DATABASE "${TEMPLATE_DB}"`))
  const client = await connect(urlForDatabase(TEMPLATE_DB).toString())
  try {
    await client.query(migrationSql())
  } finally {
    await client.end()
  }
}

async function cloneTemplate(database: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await withClient((client) =>
        client.query(`CREATE DATABASE "${database}" TEMPLATE "${TEMPLATE_DB}"`),
      )
      return
    } catch (e) {
      if ((e as { code?: string }).code !== OBJECT_IN_USE || attempt === CLONE_ATTEMPTS) throw e
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
    }
  }
}

async function dropSchema(schema: string): Promise<void> {
  // A query the test file left in flight can still hold locks in the schema, and Postgres
  // may pick the drop as the deadlock victim.
  for (let attempt = 1; ; attempt++) {
    try {
      await withClient((client) => client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`))
      return
    } catch (e) {
      if ((e as { code?: string }).code !== DEADLOCK_DETECTED || attempt === DROP_ATTEMPTS) throw e
    }
  }
}

async function dropDatabase(database: string): Promise<void> {
  // FORCE disconnects a query the test file left in flight, which would otherwise block the drop.
  await withClient((client) => client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`))
}

/**
 * Once per run: clears what an interrupted run left, then prepares the mode. Building the
 * template, or one probe schema, makes a broken migration or an unreachable database fail
 * here with one clear error instead of once per test file. Every copy must be marked
 * disposable for the dev-database scripts to run against it (see scripts/disposable-db.ts).
 */
export async function prepareTestDb(): Promise<void> {
  await dropStale()
  if (testDbMode() === 'clone') {
    await createTemplate()
  } else {
    await createSchema(`${DB_PREFIX}probe`)
    await withClient(markDisposable)
  }
}

/**
 * Gives a test file its private copy, named `name`. A clone is marked disposable here, since
 * it does not inherit the template's database settings; schema copies share the server's
 * database, which `prepareTestDb` marks.
 */
export async function createTestDb(name: string): Promise<void> {
  if (testDbMode() === 'clone') {
    await cloneTemplate(name)
    const client = await connect(urlForDatabase(name).toString())
    try {
      await markDisposable(client)
    } finally {
      await client.end()
    }
  } else {
    await createSchema(name)
  }
}

export async function dropTestDb(name: string): Promise<void> {
  if (testDbMode() === 'clone') await dropDatabase(name)
  else await dropSchema(name)
}

/** Drops the template and every copy an interrupted run left, whichever mode made them. */
export async function dropStale(): Promise<void> {
  await withClient(async (client) => {
    const like = `${DB_PREFIX.replace('_', '\\_')}%`
    const databases = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE $1`,
      [like],
    )
    for (const { datname } of databases.rows) {
      await client.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`)
    }
    const schemas = await client.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE $1`,
      [like],
    )
    for (const { nspname } of schemas.rows) {
      await client.query(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`)
    }
  })
}
