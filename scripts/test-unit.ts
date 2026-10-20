/**
 * Runs the unit tier with coverage. When the run fails only because coverage fell short, it
 * then lists the uncovered lines, so the gaps are in the same output as the failure. A failing
 * test is already described in full by vitest, and its coverage is incomplete, so no list follows.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { currentReport } from './coverage-report'
import { logger } from '../lib/logger'

const RESULTS_FILE = path.resolve('tmp', 'unit-results.json')

/** Extra arguments select tests, and a partial run cannot reach full coverage. */
const args = process.argv.slice(2)

fs.rmSync(RESULTS_FILE, { force: true })
const { status } = spawnSync('npx', ['vitest', 'run', '--coverage', ...args], { stdio: 'inherit' })

if (status !== 0 && args.length === 0 && fs.existsSync(RESULTS_FILE)) {
  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')) as {
    numFailedTests: number
    numFailedTestSuites: number
  }
  if (results.numFailedTests === 0 && results.numFailedTestSuites === 0) {
    logger.info(`\n${currentReport()}`)
  }
}

process.exit(status ?? 1)
