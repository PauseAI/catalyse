/**
 * Finds a worker count for this machine: runs one suite at each count you list, one run at a
 * time, and reports wall time with the peak swap and load the run caused.
 *
 *   npx tsx scripts/tune-workers.ts unit 2 3 4 6
 *   npx tsx scripts/tune-workers.ts e2e 2 3 4
 *
 * Quit other heavy work first, or the numbers measure that instead. Pick the smallest count
 * after which the time stops improving much and swap and load stay low, then set
 * `VITEST_MAX_WORKERS` (unit) or `WORKER_COUNT` (e2e) in .env.local.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { logger } from '../lib/logger'

const SUITES = {
  unit: { script: 'test:unit', env: 'VITEST_MAX_WORKERS' },
  e2e: { script: 'test:e2e', env: 'WORKER_COUNT' },
} as const

const SAMPLE_INTERVAL_MS = 2000
// A 1-minute load average above this at the start means something else is running.
const BUSY_LOAD = 2

/** Swap in use, in MB. */
function swapUsedMb(): number {
  if (process.platform === 'darwin') {
    const out = execSync('sysctl -n vm.swapusage', { encoding: 'utf8' })
    return parseFloat(/used = ([\d.]+)M/.exec(out)?.[1] ?? '0')
  }
  const meminfo = fs.readFileSync('/proc/meminfo', 'utf8')
  const kb = (key: string) =>
    parseInt(new RegExp(`${key}:\\s+(\\d+)`).exec(meminfo)?.[1] ?? '0', 10)
  return (kb('SwapTotal') - kb('SwapFree')) / 1024
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

type Result = { count: number; ms: number; ok: boolean; peakSwapMb: number; peakLoad: number }

async function runOnce(suite: keyof typeof SUITES, count: number): Promise<Result> {
  const { script, env } = SUITES[suite]
  const log = path.join(os.tmpdir(), `tune-workers-${suite}-${count}.log`)
  const fd = fs.openSync(log, 'w')
  let peakSwapMb = swapUsedMb()
  let peakLoad = os.loadavg()[0]
  const sampler = setInterval(() => {
    peakSwapMb = Math.max(peakSwapMb, swapUsedMb())
    peakLoad = Math.max(peakLoad, os.loadavg()[0])
  }, SAMPLE_INTERVAL_MS)

  const startedAt = Date.now()
  const status = await new Promise<number | null>((resolve) => {
    const child = spawn('npm', ['run', script], {
      stdio: ['ignore', fd, fd],
      env: { ...process.env, [env]: String(count) },
    })
    child.on('close', resolve)
  })
  clearInterval(sampler)
  fs.closeSync(fd)

  const ok = status === 0
  if (!ok) logger.info(`  ${suite} at ${count} workers failed (exit ${status}); output in ${log}`)
  return { count, ms: Date.now() - startedAt, ok, peakSwapMb, peakLoad }
}

async function main() {
  const [suite, ...rest] = process.argv.slice(2)
  const counts = rest.map(Number)
  if (
    !(suite in SUITES) ||
    counts.length === 0 ||
    counts.some((c) => !Number.isInteger(c) || c < 1)
  ) {
    logger.error('Usage: npx tsx scripts/tune-workers.ts <unit|e2e> <count> [<count> ...]')
    process.exit(2)
  }

  const load = os.loadavg()[0]
  const baselineSwapMb = swapUsedMb()
  logger.info(
    `${os.availableParallelism()} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM, ` +
      `load ${load.toFixed(1)}, swap in use ${Math.round(baselineSwapMb)} MB before starting`,
  )
  if (load > BUSY_LOAD)
    logger.warn(`Warning: load is above ${BUSY_LOAD}; other work will skew the results.`)

  const results: Result[] = []
  for (const count of counts) {
    logger.info(`\n▶ ${suite} with ${count} worker${count > 1 ? 's' : ''}`)
    results.push(await runOnce(suite as keyof typeof SUITES, count))
  }

  logger.info(`\n${suite} (peak load is a 1-minute average, so it lags)`)
  logger.info('  workers      time  peak swap  peak load')
  for (const r of results) {
    logger.info(
      `  ${String(r.count).padStart(7)}  ${formatDuration(r.ms).padStart(8)}  ` +
        `${`${Math.round(r.peakSwapMb)} MB`.padStart(9)}  ${r.peakLoad.toFixed(1).padStart(9)}` +
        (r.ok ? '' : '  FAILED'),
    )
  }
}

void main()
