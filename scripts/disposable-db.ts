/**
 * Scripts that empty, restore over or anonymise a database run only against one marked
 * disposable, with `ALTER DATABASE ... SET catalyse.disposable = on`. Production is never
 * marked, so a script pointed at it by any route (a tunnel, a copied URL, a renamed database)
 * refuses. The mark lives on the database, so emptying the public schema keeps it, and a
 * restore without `--create` never carries one over. `npm run mark-disposable` marks one.
 */

import type { Client } from 'pg'

const SETTING = 'catalyse.disposable'

/** Reads the stored mark, not the session's setting, so a session-level SET cannot fake it. */
export async function isDisposable(db: Client): Promise<boolean> {
  const { rows } = await db.query<{ marked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
       WHERE d.datname = current_database() AND s.setrole = 0 AND $1 = ANY (s.setconfig)
     ) AS marked`,
    [`${SETTING}=on`],
  )
  return rows[0].marked
}

export async function databaseName(db: Client): Promise<string> {
  const { rows } = await db.query<{ name: string }>('SELECT current_database() AS name')
  return rows[0].name
}

export async function markDisposable(db: Client): Promise<void> {
  const name = (await databaseName(db)).replaceAll('"', '""')
  await db.query(`ALTER DATABASE "${name}" SET ${SETTING} = on`)
}

export async function assertDisposable(db: Client, action: string): Promise<void> {
  if (await isDisposable(db)) return
  throw new Error(
    `Refusing to ${action}: database "${await databaseName(db)}" is not marked disposable. ` +
      'If it is a throwaway copy, mark it with `npm run mark-disposable`.',
  )
}

/**
 * Before a restore: a database with no tables has nothing to lose, so it is marked (a new
 * local volume, a new PR preview); any other must already carry the mark.
 */
export async function claimDisposable(db: Client, action: string): Promise<void> {
  if (await isDisposable(db)) return
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`,
  )
  if (rows[0].n > 0) await assertDisposable(db, action)
  else await markDisposable(db)
}
