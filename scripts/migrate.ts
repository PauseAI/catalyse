import { execSync } from 'child_process'
import { readdirSync, rmdirSync } from 'fs'
import { join } from 'path'
import { Client } from 'pg'
import { resolveDbUrl } from '../lib/db-url'
import { logger } from '../lib/logger'
import { libpqUrl, runBackupJob } from '../jobs/backup'

process.env.DATABASE_URL = resolveDbUrl()

function removeEmptyMigrationDirs() {
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations')
  const entries = readdirSync(migrationsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(migrationsDir, entry.name)
    const files = readdirSync(dir)
    if (!files.includes('migration.sql')) {
      logger.warn(`[MIGRATE] migration dir "${entry.name}" has no migration.sql — removing`)
      rmdirSync(dir)
    }
  }
}

/** An unmigrated or not-yet-loaded database has nothing worth a backup, and a dump of it would
 * become the newest backup in B2. */
async function hasVolunteers(): Promise<boolean> {
  const client = new Client({ connectionString: libpqUrl(resolveDbUrl()) })
  await client.connect()
  try {
    // Two statements: a single one naming a missing table fails at parse time.
    const table = await client.query("SELECT to_regclass('public.volunteers') AS t")
    if (table.rows[0].t === null) return false
    const { rows } = await client.query<{ present: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM volunteers) AS present',
    )
    return rows[0].present
  } finally {
    await client.end()
  }
}

async function main() {
  removeEmptyMigrationDirs()

  if (process.env.RAILWAY_ENVIRONMENT_NAME === 'production' && (await hasVolunteers())) {
    logger.info('[MIGRATE] Running pre-deploy backup...')
    await runBackupJob().catch((err: unknown) =>
      logger.error(err, '[MIGRATE] Backup failed (continuing):'),
    )
  }

  execSync('npx prisma migrate deploy', { stdio: 'inherit' })
}

main().catch((err) => {
  logger.error(err, '[MIGRATE] Fatal error:')
  process.exit(1)
})
