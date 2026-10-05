import { pbkdf2Sync, randomBytes } from 'node:crypto'
import type { Client } from 'pg'

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
): Promise<void> {
  await db.query(
    `INSERT INTO volunteers (name, email, password_hash, is_admin, location, country, local_group, location_confirmed_at, created_at, updated_at, approval_status, email_confirmed, consent_make_profile_visible_in_directory)
     VALUES ($1, $2, $3, $4, 'London, UK', 'UK', 'London', now(), now(), now(), 'approved', true, false)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = EXCLUDED.is_admin, deleted_at = NULL`,
    [name, email, makePasswordHash(password), isAdmin],
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
): Promise<void> {
  for (const { key, label, isAdmin } of ROLES) {
    const emails = devAccountEmails(key, counts[key])
    for (const [i, email] of emails.entries()) {
      await upsertAccount(db, i === 0 ? label : `${label} ${i}`, email, 'password1', isAdmin)
    }
  }
}
