// Runs before `npm run dev` (via the `predev` script). Branch switches often
// bring schema/migration changes without a matching client regen, which fails
// at runtime with "Export X doesn't exist" rather than at startup. Compares a
// hash of schema.prisma against the hash recorded at the last generate, so it
// catches the mismatch regardless of file mtimes (which `git checkout` does
// not reliably bump).
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { logger } from '../lib/logger'

const schemaPath = 'prisma/schema.prisma'
const hashPath = 'generated/prisma/.schema-hash'

const currentHash = createHash('sha256').update(readFileSync(schemaPath)).digest('hex')
const storedHash = existsSync(hashPath) ? readFileSync(hashPath, 'utf8').trim() : null

if (currentHash !== storedHash) {
  logger.info('schema.prisma changed since the last generate — running migrate + generate')
  execSync('npm run migrate && npm run generate', { stdio: 'inherit' })
  writeFileSync(hashPath, currentHash)
}
