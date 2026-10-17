/**
 * Runs every check in order, stopping at the first failure, and ends with how long each
 * step took. Each step's own output streams through untouched.
 */
import { spawnSync } from 'node:child_process'
import { logger } from '../lib/logger'

const STEPS = ['typecheck', 'lint', 'format:check', 'test:unit', 'test:e2e']

function formatDuration(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`
}

const timings: { step: string; ms: number; ok: boolean }[] = []
const startedAt = Date.now()
let exitCode = 0

for (const step of STEPS) {
  logger.info(`\n▶ npm run ${step}\n`)
  const stepStart = Date.now()
  const { status } = spawnSync('npm', ['run', step], { stdio: 'inherit' })
  const ok = status === 0
  timings.push({ step, ms: Date.now() - stepStart, ok })
  if (!ok) {
    exitCode = status ?? 1
    break
  }
}

const width = Math.max(...STEPS.map((s) => s.length))
logger.info('\nTimings')
for (const { step, ms, ok } of timings) {
  logger.info(`  ${step.padEnd(width)}  ${formatDuration(ms).padStart(8)}${ok ? '' : '  FAILED'}`)
}
const skipped = STEPS.slice(timings.length)
if (skipped.length) logger.info(`  not run: ${skipped.join(', ')}`)
logger.info(`  ${'total'.padEnd(width)}  ${formatDuration(Date.now() - startedAt).padStart(8)}`)

process.exit(exitCode)
