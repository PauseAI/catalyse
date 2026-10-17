#!/usr/bin/env node
/**
 * Ensures the Postgres client tools (`pg_dump`, `pg_restore`) that `fetch-prod-db` and the
 * backup job shell out to are on PATH, installing them with the machine's package manager
 * when they are missing. Does nothing if they are already there.
 *
 * Usage:
 *   npx tsx scripts/install-pg-tools.ts
 */

import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'
import { fileURLToPath } from 'node:url'
import { logger } from '../lib/logger'

// Matches the server in docker-compose.yml and production; pg_restore cannot read a dump
// made by a newer pg_dump.
const MIN_MAJOR = 18

interface Installer {
  name: string
  commands: string[][]
}

function toolMajor(tool: string): number | null {
  try {
    const out = execFileSync(tool, ['--version'], { encoding: 'utf8' })
    const match = /(\d+)(?:\.\d+)*/.exec(out.replace(/^[^\d]*/, ''))
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

function has(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function elevated(command: string[]): string[] {
  return process.getuid?.() === 0 ? command : ['sudo', ...command]
}

export function pickInstaller(os: string, hasCommand: (c: string) => boolean): Installer | null {
  if (os === 'darwin' && hasCommand('brew')) {
    return {
      name: 'Homebrew',
      commands: [
        ['brew', 'install', 'libpq'],
        ['brew', 'link', '--force', 'libpq'],
      ],
    }
  }
  if (os !== 'linux') return null
  if (hasCommand('apt-get')) {
    return {
      name: 'apt',
      commands: [elevated(['apt-get', 'install', '-y', 'postgresql-client'])],
    }
  }
  if (hasCommand('dnf')) {
    return { name: 'dnf', commands: [elevated(['dnf', 'install', '-y', 'postgresql'])] }
  }
  if (hasCommand('pacman')) {
    return {
      name: 'pacman',
      commands: [elevated(['pacman', '-S', '--noconfirm', 'postgresql-libs', 'postgresql'])],
    }
  }
  if (hasCommand('apk')) {
    return { name: 'apk', commands: [elevated(['apk', 'add', 'postgresql-client'])] }
  }
  return null
}

function main(): void {
  const major = toolMajor('pg_restore')
  if (major !== null && toolMajor('pg_dump') !== null) {
    if (major < MIN_MAJOR) {
      logger.warn(
        `pg_restore ${major} is older than the Postgres ${MIN_MAJOR} used in production; ` +
          `restoring a prod dump may fail. Install a newer client (https://www.postgresql.org/download/).`,
      )
    }
    return
  }

  const installer = pickInstaller(platform(), has)
  if (!installer) {
    logger.error(
      'pg_dump/pg_restore not found and no supported package manager detected.\n' +
        `Install the Postgres ${MIN_MAJOR} client tools yourself: https://www.postgresql.org/download/`,
    )
    process.exit(1)
  }

  logger.info(`Installing Postgres client tools with ${installer.name}...`)
  for (const [cmd, ...args] of installer.commands) {
    execFileSync(cmd, args, { stdio: 'inherit' })
  }

  const installed = toolMajor('pg_restore')
  if (installed === null) {
    logger.error('Installed, but pg_restore is still not on PATH. Open a new shell and retry.')
    process.exit(1)
  }
  if (installed < MIN_MAJOR) {
    logger.warn(
      `Installed pg_restore ${installed}, older than the Postgres ${MIN_MAJOR} used in production. ` +
        'Restoring a prod dump may fail; install a newer client from https://www.postgresql.org/download/.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (err) {
    logger.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
