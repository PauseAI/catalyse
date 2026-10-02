#!/usr/bin/env node
/**
 * Marks the database at DATABASE_URL disposable, so fetch-prod-db and anonymise-db will
 * overwrite it (see disposable-db.ts). Only for a copy holding nothing you need.
 *
 * Usage:
 *   npm run mark-disposable
 */

import { Client } from 'pg'
import { libpqUrl } from '../jobs/backup'
import { resolveDbUrl } from '../lib/db-url'
import { databaseName, markDisposable } from './disposable-db'

async function main(): Promise<void> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === 'production') {
    console.error('Refusing to run in the production environment')
    process.exit(1)
  }
  const db = new Client({ connectionString: libpqUrl(resolveDbUrl()) })
  await db.connect()
  try {
    await markDisposable(db)
    console.log(`Marked "${await databaseName(db)}" disposable.`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
