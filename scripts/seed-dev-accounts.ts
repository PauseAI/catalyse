import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import type { Client } from 'pg'
import { resolveDbUrl } from '../lib/db-url'
import { assertDisposable } from './disposable-db'

export function makePasswordHash(password: string): string {
  const salt = randomBytes(32)
  const key = pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  return Buffer.concat([salt, key]).toString('base64')
}

async function upsertAccount(
  db: Client,
  name: string,
  email: string,
  password: string,
  isAdmin: boolean,
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO volunteers (name, email, password_hash, is_admin, location, country, local_group, location_confirmed_at, created_at, updated_at, approval_status, email_confirmed, consent_make_profile_visible_in_directory)
     VALUES ($1, $2, $3, $4, 'London, UK', 'UK', 'London', now(), now(), now(), 'approved', true, false)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = EXCLUDED.is_admin, deleted_at = NULL
     RETURNING id`,
    [name, email, makePasswordHash(password), isAdmin],
  )
  return rows[0].id
}

/**
 * The bearer token a seeded dev account signs in with, so a browser can be signed in without
 * typing a password: `volunteer2@example.com` gets `dev-volunteer2`.
 */
export function devSessionToken(email: string): string {
  return `dev-${email.split('@')[0]}`
}

/**
 * Dev session tokens are written down in the repo, so they are seeded only into a database on
 * this machine, never a Railway one (PR previews run this seed too).
 */
export function devSessionsAllowed(dbUrl: string): boolean {
  if (process.env.RAILWAY_ENVIRONMENT_NAME) return false
  const host = new URL(dbUrl).hostname
  return ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.localhost')
}

const DEV_SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000

async function upsertDevSession(db: Client, volunteerId: number, email: string): Promise<void> {
  // The same digest as `hashToken` in lib/auth, which this script keeps clear of Prisma.
  const tokenHash = createHash('sha256').update(devSessionToken(email)).digest('hex')
  await db.query(
    `INSERT INTO sessions (volunteer_id, token_hash, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO UPDATE SET volunteer_id = EXCLUDED.volunteer_id, expires_at = EXCLUDED.expires_at`,
    [volunteerId, tokenHash, new Date(Date.now() + DEV_SESSION_TTL_MS)],
  )
}

export interface DevAccountCounts {
  volunteer: number
  admin: number
  superadmin: number
}

const ROLES = [
  { key: 'volunteer', label: 'Dev Volunteer', isAdmin: false },
  { key: 'admin', label: 'Dev Admin', isAdmin: true },
  { key: 'superadmin', label: 'Dev Super Admin', isAdmin: true },
] as const

function countFromEnv(name: string): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return 1
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`)
  return n
}

export function devAccountCountsFromEnv(): DevAccountCounts {
  return {
    volunteer: countFromEnv('SEED_VOLUNTEERS'),
    admin: countFromEnv('SEED_ADMINS'),
    superadmin: countFromEnv('SEED_SUPERADMINS'),
  }
}

/** The first account of a role is `volunteer@example.com`, then `volunteer1@`, `volunteer2@`, ... */
export function devAccountEmails(role: keyof DevAccountCounts, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${role}${i === 0 ? '' : i}@example.com`)
}

export async function seedDevAccounts(
  db: Client,
  counts: DevAccountCounts = devAccountCountsFromEnv(),
  withSessions: boolean = devSessionsAllowed(resolveDbUrl()),
): Promise<void> {
  await assertDisposable(db, 'seed dev accounts into it')
  for (const { key, label, isAdmin } of ROLES) {
    const emails = devAccountEmails(key, counts[key])
    for (const [i, email] of emails.entries()) {
      const id = await upsertAccount(
        db,
        i === 0 ? label : `${label} ${i}`,
        email,
        'password1',
        isAdmin,
      )
      if (withSessions) await upsertDevSession(db, id, email)
    }
  }
}
