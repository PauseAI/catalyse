// Post-generate patches for generated/prisma/client.ts.
// Run via "npm run generate" after prisma generate completes.
// Add new patches below following the same pattern.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { logger } from '../lib/logger'

const file = 'generated/prisma/client.ts'
let content: string = readFileSync(file, 'utf8')
let dirty = false

function patch(description: string, from: string, to: string): void {
  if (content.includes(to)) {
    logger.info(`  already applied: ${description}`)
  } else if (content.includes(from)) {
    content = content.replace(from, to)
    dirty = true
    logger.info(`  patched: ${description}`)
  } else {
    logger.warn(
      `  expected string not found for "${description}" — Prisma generator may have changed`,
    )
  }
}

// Prisma's generator emits a process.cwd()-based path annotation so bundlers can
// locate the native query engine binary. Turbopack resolves process.cwd() to the
// project root and traces every file under it, causing next build to warn that
// next.config.ts was "unexpectedly" included in the NFT list for every route that
// imports Prisma. The __dirname annotation on the line above is sufficient for
// Turbopack, so we suppress the process.cwd() trace with turbopackIgnore.
patch(
  'suppress process.cwd() NFT trace in Turbopack build',
  'path.join(process.cwd(),',
  'path.join(/*turbopackIgnore: true*/ process.cwd(),',
)

if (dirty) {
  writeFileSync(file, content)
  logger.info(`Wrote ${file}`)
} else {
  logger.info(`${file}: no changes needed`)
}

// Records which schema.prisma this generate ran against, so `predev`
// (scripts/ensure-generated.ts) can detect a stale client on branch switches.
const schemaHash = createHash('sha256').update(readFileSync('prisma/schema.prisma')).digest('hex')
writeFileSync('generated/prisma/.schema-hash', schemaHash)
