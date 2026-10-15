#!/usr/bin/env node
/**
 * Anonymises PII in the database at DATABASE_URL and seeds the dev accounts. Destructive and
 * irreversible, so it refuses the production environment and any database not marked
 * disposable (see disposable-db.ts).
 *
 * Usage:
 *   npx tsx scripts/anonymise-db.ts
 */

import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { faker } from '@faker-js/faker'
import { libpqUrl } from '../jobs/backup'
import { resolveDbUrl } from '../lib/db-url'
import { makePasswordHash, seedDevAccounts } from './seed-dev-accounts'
import { COLUMN_TREATMENT, REDACTED } from './anonymise-columns'
import { assertDisposable } from './disposable-db'

// ── Anonymisation ─────────────────────────────────────────────────────────────

// Seed faker with the volunteer ID so all fake fields are deterministic per volunteer.
function fakeVolunteerData(id: number): {
  name: string
  email: string
  bio: string
  discordHandle: string
  signalNumber: string
  whatsappNumber: string
  contactNotes: string
  otherSkills: string
  location: string
  localGroup: string
} {
  faker.seed(id)
  const firstName = faker.person.firstName()
  const lastName = faker.person.lastName()
  return {
    name: `${firstName} ${lastName}`,
    // A reserved domain and the id: faker's default providers are real ones, where an
    // invented address can be somebody's, and two volunteers can draw the same name.
    email: `${`${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, '')}.${id}@example.com`,
    bio: faker.lorem.sentence(),
    discordHandle: faker.internet.username(),
    signalNumber: faker.phone.number({ style: 'international' }),
    whatsappNumber: faker.phone.number({ style: 'international' }),
    contactNotes: faker.lorem.sentence(),
    otherSkills: faker.lorem.words({ min: 2, max: 5 }),
    location: `${faker.location.city()}, ${faker.location.country()}`,
    localGroup: faker.location.city(),
  }
}

export async function anonymise(db: Client): Promise<void> {
  await assertDisposable(db, 'anonymise it')
  // One known password for every account, admin flags kept, so a developer can sign in as
  // anyone. An anonymised copy must therefore never sit behind a public URL.
  const anonPasswordHash = makePasswordHash('volunteerpass1')

  const { rows: volunteerRows } = await db.query<{
    id: number
    bio: string | null
    discord_handle: string | null
    signal_number: string | null
    whatsapp_number: string | null
    contact_notes: string | null
    other_skills: string | null
    location: string | null
    local_group: string | null
  }>(
    'SELECT id, bio, discord_handle, signal_number, whatsapp_number, contact_notes, other_skills, location, local_group FROM volunteers',
  )
  for (const row of volunteerRows) {
    const f = fakeVolunteerData(row.id)
    await db.query(
      `UPDATE volunteers SET
        name = $1, email = $2, bio = $3, discord_handle = $4, signal_number = $5,
        whatsapp_number = $6, contact_notes = $7, other_skills = $8, location = $9,
        local_group = $10, auth_token = NULL, auth_token_expires_at = NULL, password_hash = $11
      WHERE id = $12`,
      [
        f.name,
        f.email,
        row.bio !== null ? f.bio : null,
        row.discord_handle !== null ? f.discordHandle : null,
        row.signal_number !== null ? f.signalNumber : null,
        row.whatsapp_number !== null ? f.whatsappNumber : null,
        row.contact_notes !== null ? f.contactNotes : null,
        row.other_skills !== null ? f.otherSkills : null,
        row.location !== null ? f.location : null,
        row.local_group !== null ? f.localGroup : null,
        anonPasswordHash,
        row.id,
      ],
    )
  }

  const { rows: adminInvites } = await db.query<{ id: number; invited_by_id: number }>(
    'SELECT id, invited_by_id FROM admin_invites',
  )
  for (const row of adminInvites) {
    await db.query('UPDATE admin_invites SET email = $1 WHERE id = $2', [
      fakeVolunteerData(row.invited_by_id).email,
      row.id,
    ])
  }

  const present = await presentColumns(db)
  if (present.has('experimental_journalists.email')) await anonymiseJournalists(db)
  if (present.has('experimental_outreach_participants.email')) {
    await db.query(
      "UPDATE experimental_outreach_participants SET email = 'participant' || id || '@example.com'",
    )
  }
  await applyTreatments(db, present)
}

// The dump being anonymised can predate this code's migrations, so a column the map names
// may not exist yet.
async function presentColumns(db: Client): Promise<Set<string>> {
  const { rows } = await db.query<{ table_name: string; column_name: string }>(
    'SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()',
  )
  return new Set(rows.map((r) => `${r.table_name}.${r.column_name}`))
}

async function anonymiseJournalists(db: Client): Promise<void> {
  const { rows } = await db.query<{ id: number }>('SELECT id FROM experimental_journalists')
  for (const { id } of rows) {
    // Offset so a journalist never shares a seed, and so a fake identity, with a volunteer.
    faker.seed(1_000_000 + id)
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()
    await db.query(
      'UPDATE experimental_journalists SET first_name = $1, last_name = $2, email = $3, organisation = $4 WHERE id = $5',
      [firstName, lastName, `journalist${id}@example.com`, faker.company.name(), id],
    )
  }
}

const RANDOM_TOKEN_SQL = "replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')"

async function applyTreatments(db: Client, present: Set<string>): Promise<void> {
  for (const [table, columns] of Object.entries(COLUMN_TREATMENT)) {
    const treated = Object.entries(columns).filter(([column]) => present.has(`${table}.${column}`))
    if (treated.some(([, treatment]) => treatment === 'rows-deleted')) {
      await db.query(`DELETE FROM "${table}"`)
      continue
    }
    for (const [column, treatment] of treated) {
      if (treatment === 'redact') {
        await db.query(`UPDATE "${table}" SET "${column}" = $1 WHERE "${column}" IS NOT NULL`, [
          REDACTED,
        ])
      } else if (treatment === 'null') {
        await db.query(`UPDATE "${table}" SET "${column}" = NULL`)
      } else if (treatment === 'token') {
        await db.query(
          `UPDATE "${table}" SET "${column}" = ${RANDOM_TOKEN_SQL} WHERE "${column}" IS NOT NULL`,
        )
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === 'production') {
    console.error('Refusing to run in the production environment')
    process.exit(1)
  }

  const dbUrl = libpqUrl(resolveDbUrl())
  const db = new Client({ connectionString: dbUrl })
  await db.connect()
  try {
    console.log(`Anonymising ${new URL(dbUrl).pathname.slice(1)}...`)
    await anonymise(db)
    console.log('Seeding dev accounts...')
    await seedDevAccounts(db)
  } finally {
    await db.end()
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
