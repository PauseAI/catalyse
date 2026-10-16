import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import type { Client } from 'pg'
import { resolveDbUrl } from '../lib/db-url'
import { assertDisposable } from './disposable-db'

export function makePasswordHash(password: string): string {
  const salt = randomBytes(32)
  const key = pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  return Buffer.concat([salt, key]).toString('base64')
}

/** A seeded chapter: the UK first, as every dev account but the extra leads lives there. */
const SEED_CHAPTERS = [
  { country: 'UK', name: 'United Kingdom' },
  { country: 'Germany', name: 'Germany' },
  { country: 'France', name: 'France' },
  { country: 'Sweden', name: 'Sweden' },
  { country: 'Spain', name: 'Spain' },
] as const

async function ensureChapter(db: Client, country: string, name: string): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO national_chapters (country, name) VALUES ($1, $2)
     ON CONFLICT (country) DO UPDATE SET country = EXCLUDED.country
     RETURNING id`,
    [country, name],
  )
  return rows[0].id
}

async function upsertAccount(
  db: Client,
  name: string,
  email: string,
  password: string,
  isAdmin: boolean,
  chapter: { id: number; country: string },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO volunteers (name, email, password_hash, is_admin, location, country, national_chapter_id, local_group_id, location_confirmed_at, created_at, updated_at, approval_status, email_confirmed, consent_make_profile_visible_in_directory)
     VALUES ($1, $2, $3, $4, 'London', $5, $6,
       (SELECT id FROM local_groups WHERE national_chapter_id = $6 AND name = 'London'),
       now(), now(), now(), 'approved', true, false)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = EXCLUDED.is_admin,
       country = EXCLUDED.country, national_chapter_id = EXCLUDED.national_chapter_id,
       local_group_id = EXCLUDED.local_group_id, deleted_at = NULL
     RETURNING id`,
    [name, email, makePasswordHash(password), isAdmin, chapter.country, chapter.id],
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
  lead: number
  deputy: number
  admin: number
  superadmin: number
}

/**
 * Volunteers and deputies are in the UK chapter. The first lead leads the UK, each further one
 * another country's chapter, so more than one chapter can be tried. Admins and super admins are
 * global admins once their addresses are in ADMIN_EMAILS.
 */
const ROLES = [
  { key: 'volunteer', label: 'Dev Volunteer', isAdmin: false },
  { key: 'lead', label: 'Dev Lead', isAdmin: false },
  { key: 'deputy', label: 'Dev Deputy', isAdmin: false },
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
    lead: countFromEnv('SEED_LEADS'),
    deputy: countFromEnv('SEED_DEPUTIES'),
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
  if (counts.lead > SEED_CHAPTERS.length) {
    throw new Error(`SEED_LEADS can be at most ${SEED_CHAPTERS.length}, one per seeded chapter`)
  }
  const uk = { id: await ensureChapter(db, 'UK', 'United Kingdom'), country: 'UK' }
  for (const { key, label, isAdmin } of ROLES) {
    const emails = devAccountEmails(key, counts[key])
    for (const [i, email] of emails.entries()) {
      const home = key === 'lead' ? SEED_CHAPTERS[i] : SEED_CHAPTERS[0]
      const chapter =
        home.country === 'UK'
          ? uk
          : { id: await ensureChapter(db, home.country, home.name), country: home.country }
      const id = await upsertAccount(
        db,
        i === 0 ? label : `${label} ${i}`,
        email,
        'password1',
        isAdmin,
        chapter,
      )
      if (key === 'lead') {
        await db.query(`DELETE FROM chapter_deputies WHERE volunteer_id = $1`, [id])
        await db.query(`UPDATE national_chapters SET lead_id = NULL WHERE lead_id = $1`, [id])
        await db.query(`UPDATE national_chapters SET lead_id = $1 WHERE id = $2`, [id, chapter.id])
      }
      if (key === 'deputy') {
        await db.query(
          `INSERT INTO chapter_deputies (national_chapter_id, volunteer_id) VALUES ($1, $2)
           ON CONFLICT (volunteer_id) DO UPDATE SET national_chapter_id = EXCLUDED.national_chapter_id`,
          [chapter.id, id],
        )
      }
      if (withSessions) await upsertDevSession(db, id, email)
    }
  }
}
