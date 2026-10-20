import { execSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { resolveDbUrl } from '../lib/db-url'
import { logger } from '../lib/logger'

const name = process.argv[2]
if (!name) {
  logger.error('Usage: npm run new-migration <migration_name>')
  process.exit(1)
}

const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const ts =
  `${now.getFullYear()}` +
  `${pad(now.getMonth() + 1)}` +
  `${pad(now.getDate())}` +
  `${pad(now.getHours())}` +
  `${pad(now.getMinutes())}` +
  `${pad(now.getSeconds())}`

const dirName = `${ts}_${name}`
const dirPath = join(process.cwd(), 'prisma', 'migrations', dirName)

mkdirSync(dirPath, { recursive: true })

const dbUrl = resolveDbUrl()
const sql = execSync(
  `npx prisma migrate diff --from-url "${dbUrl}" --to-schema-datamodel prisma/schema.prisma --script`,
  { encoding: 'utf8' },
)

const sqlPath = join(dirPath, 'migration.sql')
writeFileSync(sqlPath, sql)

logger.info(`Created: prisma/migrations/${dirName}/migration.sql`)
logger.info('Review the SQL, then run: npm run migrate && npx prisma generate')
