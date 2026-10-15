import { afterEach, describe, it, expect, vi } from 'vitest'
import { Client } from 'pg'
import { prisma } from '@/lib/prisma'
import { resolveDbUrl } from '@/lib/db-url'
import { getCurrentVolunteer } from '@/lib/auth'
import { libpqUrl } from '../jobs/backup'
import { devSessionToken, devSessionsAllowed, seedDevAccounts } from './seed-dev-accounts'

/** A pg client on this test file's own schema, which is what the seeder is handed. */
async function withSchemaClient<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const url = new URL(resolveDbUrl())
  const db = new Client({ connectionString: libpqUrl(url.toString()) })
  await db.connect()
  try {
    await db.query(`SET search_path TO "${url.searchParams.get('schema')}"`)
    return await fn(db)
  } finally {
    await db.end()
  }
}

const counts = { volunteer: 2, admin: 1, superadmin: 0 }

afterEach(async () => {
  vi.unstubAllEnvs()
  await prisma.session.deleteMany()
})

describe('seedDevAccounts', () => {
  it('signs each seeded account in with the token named after its email, across reseeds', async () => {
    await withSchemaClient((db) => seedDevAccounts(db, counts, true))
    await withSchemaClient((db) => seedDevAccounts(db, counts, true))

    expect(devSessionToken('volunteer1@example.com')).toBe('dev-volunteer1')
    const volunteer = await getCurrentVolunteer('Bearer dev-volunteer1')
    expect(volunteer?.email).toBe('volunteer1@example.com')
    const admin = await getCurrentVolunteer('Bearer dev-admin')
    expect(admin).toMatchObject({ email: 'admin@example.com', isAdmin: true })
    expect(await prisma.session.count()).toBe(3)
  })

  it('seeds no sessions into a database that is not on this machine', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'pr-123')
    await withSchemaClient((db) => seedDevAccounts(db, counts))

    expect(await prisma.volunteer.count({ where: { email: 'admin@example.com' } })).toBe(1)
    expect(await prisma.session.count()).toBe(0)
  })
})

describe('devSessionsAllowed', () => {
  it('allows only a loopback database outside Railway', () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', '')
    expect(devSessionsAllowed('postgresql://u:p@localhost:5432/db')).toBe(true)
    expect(devSessionsAllowed('postgresql://u:p@127.0.0.1/db')).toBe(true)
    expect(devSessionsAllowed('postgresql://u:p@[::1]:5432/db')).toBe(true)
    expect(devSessionsAllowed('postgresql://u:p@pg.localhost/db')).toBe(true)
    expect(devSessionsAllowed('postgresql://u:p@postgres.railway.internal:5432/db')).toBe(false)
    expect(devSessionsAllowed('postgresql://u:p@localhost.example.com/db')).toBe(false)

    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production')
    expect(devSessionsAllowed('postgresql://u:p@localhost:5432/db')).toBe(false)
  })
})
