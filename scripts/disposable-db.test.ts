import { afterEach, describe, it, expect } from 'vitest'
import { Client } from 'pg'
import { DB_PREFIX, resolveTestDbUrl, withClient } from '@/test/pg'
import { anonymise } from './anonymise-db'
import { seedDevAccounts } from './seed-dev-accounts'
import { assertDisposable, claimDisposable, isDisposable, markDisposable } from './disposable-db'

const scratch: string[] = []

/** A new, unmarked database on the test server, standing in for one nobody has marked. */
async function withScratchDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const name = `${DB_PREFIX}scratch_${Math.random().toString(36).slice(2)}`
  await withClient((client) => client.query(`CREATE DATABASE "${name}"`))
  scratch.push(name)
  const url = new URL(resolveTestDbUrl())
  url.pathname = `/${name}`
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  try {
    return await fn(db)
  } finally {
    await db.end()
  }
}

afterEach(async () => {
  for (const name of scratch.splice(0)) {
    await withClient((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`))
  }
})

const counts = { volunteer: 1, admin: 1, superadmin: 0 }

describe('a database not marked disposable', () => {
  it('is refused by the restore, the anonymiser and the dev-account seed', async () => {
    await withScratchDb(async (db) => {
      await db.query('CREATE TABLE volunteers (id int)')

      await expect(claimDisposable(db, 'restore over it')).rejects.toThrow(
        /Refusing to restore over it: database "vitest_scratch_\w+" is not marked disposable/,
      )
      await expect(anonymise(db)).rejects.toThrow(/Refusing to anonymise it/)
      await expect(seedDevAccounts(db, counts, false)).rejects.toThrow(
        /Refusing to seed dev accounts into it/,
      )
      expect(await isDisposable(db)).toBe(false)
    })
  })

  it('cannot be passed off as marked by a session-level setting', async () => {
    await withScratchDb(async (db) => {
      await db.query('SET catalyse.disposable = on')
      expect(await isDisposable(db)).toBe(false)
    })
  })
})

describe('claimDisposable', () => {
  it('marks a database with no tables, since it has nothing to lose', async () => {
    await withScratchDb(async (db) => {
      await claimDisposable(db, 'restore over it')
      expect(await isDisposable(db)).toBe(true)
    })
  })

  it('lets a marked database through, and the mark survives emptying the public schema', async () => {
    await withScratchDb(async (db) => {
      await db.query('CREATE TABLE volunteers (id int)')
      await markDisposable(db)
      await db.query('DROP SCHEMA public CASCADE')
      await db.query('CREATE SCHEMA public')

      await expect(claimDisposable(db, 'restore over it')).resolves.toBeUndefined()
      await expect(assertDisposable(db, 'anonymise it')).resolves.toBeUndefined()
    })
  })
})
