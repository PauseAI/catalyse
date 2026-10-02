#!/usr/bin/env node
/**
 * Restores the latest prod backup from B2 into the database at DATABASE_URL, then anonymises it
 * and seeds the dev accounts (scripts/anonymise-db.ts). If the scrub fails the database is
 * emptied again, so raw prod data never outlives it. Refuses to touch the production environment.
 *
 * Usage:
 *   npx tsx scripts/fetch-prod-db.ts              # reads B2 creds from .env.b2
 *   npx tsx scripts/fetch-prod-db.ts --env /path/to/.env
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { Client } from 'pg'
import { libpqUrl } from '../jobs/backup'
import { resolveDbUrl } from '../lib/db-url'
import { anonymise } from './anonymise-db'
import { seedDevAccounts } from './seed-dev-accounts'
import { claimDisposable } from './disposable-db'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const envFlagIndex = args.indexOf('--env')
const envFile = envFlagIndex !== -1 ? args[envFlagIndex + 1] : resolve(ROOT, '.env.b2')

// ── Env loading ───────────────────────────────────────────────────────────────

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const eqIdx = trimmed.indexOf('=')
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}

// ── B2 API ────────────────────────────────────────────────────────────────────

interface B2Auth {
  authToken: string
  apiUrl: string
  downloadUrl: string
  accountId: string
}

async function b2Authorize(keyId: string, appKey: string): Promise<B2Auth> {
  const credentials = Buffer.from(`${keyId}:${appKey}`).toString('base64')
  const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${credentials}` },
  })
  if (!res.ok) throw new Error(`B2 auth failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as Record<string, string>
  return {
    authToken: data.authorizationToken,
    apiUrl: data.apiUrl,
    downloadUrl: data.downloadUrl,
    accountId: data.accountId,
  }
}

async function b2GetBucketId(auth: B2Auth, bucketName: string): Promise<string> {
  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: 'POST',
    headers: { Authorization: auth.authToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: auth.accountId, bucketName }),
  })
  if (!res.ok) throw new Error(`b2_list_buckets failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { buckets: { bucketId: string }[] }
  if (!data.buckets.length) throw new Error(`Bucket '${bucketName}' not found`)
  return data.buckets[0].bucketId
}

interface B2File {
  fileName: string
  uploadTimestamp: number
  contentLength: number
}

async function b2ListFiles(auth: B2Auth, bucketId: string, prefix = ''): Promise<B2File[]> {
  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
    method: 'POST',
    headers: { Authorization: auth.authToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId, prefix, maxFileCount: 1000 }),
  })
  if (!res.ok) throw new Error(`b2_list_file_names failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { files: B2File[] }
  return data.files
}

async function b2DownloadFile(
  auth: B2Auth,
  bucketName: string,
  fileName: string,
  destPath: string,
): Promise<void> {
  const res = await fetch(`${auth.downloadUrl}/file/${bucketName}/${fileName}`, {
    headers: { Authorization: auth.authToken },
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`)
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()))
}

// ── Restore ───────────────────────────────────────────────────────────────────

async function emptyDatabase(dbUrl: string): Promise<void> {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await claimDisposable(client, 'restore over it')
    await client.query('DROP SCHEMA IF EXISTS public CASCADE')
    await client.query('CREATE SCHEMA public')
  } finally {
    await client.end()
  }
}

async function anonymiseDatabase(dbUrl: string): Promise<void> {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await anonymise(client)
    await seedDevAccounts(client)
  } finally {
    await client.end()
  }
}

/**
 * Empties the public schema and restores the dump into it. The dump's own
 * `CREATE SCHEMA public` entry is filtered out of the restore list, since the schema
 * is recreated here first; `pg_restore -l`/`-L` is the documented way to skip entries.
 */
export async function restoreDump(dumpPath: string, dbUrl: string): Promise<void> {
  await emptyDatabase(dbUrl)
  const listing = execFileSync('pg_restore', ['-l', dumpPath], { encoding: 'utf8' })
  const filtered = listing
    .split('\n')
    .filter((line) => !/ SCHEMA - public /.test(line))
    .join('\n')
  const listPath = `${dumpPath}.list`
  writeFileSync(listPath, filtered)
  execFileSync(
    'pg_restore',
    ['--no-owner', '--no-privileges', '--use-list', listPath, '--dbname', dbUrl, dumpPath],
    { stdio: 'inherit' },
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvFile(envFile)

  // The restore empties the target database first; nothing may ever point this at prod.
  if (process.env.RAILWAY_ENVIRONMENT_NAME === 'production') {
    console.error('Refusing to run in the production environment')
    process.exit(1)
  }

  // Any Railway environment must opt in, so a fork of production cannot wipe its database
  // by accident. Only preview environments set this.
  if (process.env.RAILWAY_ENVIRONMENT_NAME && process.env.ALLOW_DB_RESTORE !== '1') {
    console.error('Refusing to restore: set ALLOW_DB_RESTORE=1 to allow it in this environment')
    process.exit(1)
  }

  const keyId = process.env.B2_KEY_ID
  const appKey = process.env.B2_APP_KEY
  const bucketName = process.env.B2_BUCKET_NAME

  if (!keyId || !appKey || !bucketName) {
    console.error('Error: B2_KEY_ID, B2_APP_KEY, and B2_BUCKET_NAME must be set')
    console.error(`       Add them to '${envFile}' or export them as environment variables.`)
    process.exit(1)
  }

  const dbUrl = libpqUrl(resolveDbUrl())
  mkdirSync(resolve(ROOT, 'db'), { recursive: true })
  const dumpPath = resolve(ROOT, 'db/prod.dump')

  console.log('Authorising with B2...')
  const auth = await b2Authorize(keyId, appKey)
  const bucketId = await b2GetBucketId(auth, bucketName)

  console.log('Listing backups...')
  const files = (await b2ListFiles(auth, bucketId, 'backups/')).filter((f) =>
    f.fileName.endsWith('.dump'),
  )
  if (!files.length) {
    console.error('No Postgres backups found in B2.')
    process.exit(1)
  }

  const latest = files.reduce((a, b) => (a.uploadTimestamp > b.uploadTimestamp ? a : b))
  console.log(`Latest backup: ${latest.fileName} (${(latest.contentLength / 1024).toFixed(0)} KB)`)

  console.log('Downloading...')
  await b2DownloadFile(auth, bucketName, latest.fileName, dumpPath)

  console.log(`Restoring into ${new URL(dbUrl).pathname.slice(1)}...`)
  await restoreDump(dumpPath, dbUrl)

  console.log('Anonymising and seeding dev accounts...')
  try {
    await anonymiseDatabase(dbUrl)
  } catch (err) {
    await emptyDatabase(dbUrl)
    throw err
  }

  console.log('Done.')
  console.log('  volunteer@example.com  / password1')
  console.log('  admin@example.com      / password1')
  console.log('  superadmin@example.com / password1')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
