#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@/lib/logger'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const eqIdx = trimmed.indexOf('=')
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(resolve(ROOT, '.env.local'))
loadEnvFile(resolve(ROOT, '.env'))

const { PROD_URL, CRON_SECRET } = process.env

if (!PROD_URL) {
  logger.error('PROD_URL not set — add it to .env.local')
  process.exit(1)
}
if (!CRON_SECRET) {
  logger.error('CRON_SECRET not set — add it to .env.local')
  process.exit(1)
}

async function main() {
  const res = await fetch(`${PROD_URL}/api/cron/backup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })

  const body = await res.json()
  console.log(JSON.stringify(body, null, 2))

  if (!res.ok) process.exit(1)
}

main()
