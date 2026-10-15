/**
 * The record of what each snapshot run captured. A run writes one manifest as
 * it goes, every planned test listed up front and each capture added the
 * moment it lands, which is what lets the gallery say which run took a
 * picture and lets the next run tell a finished run from a killed one.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type TestStatus =
  /** Planned, not reached yet: a run still going, or one that was killed. */
  | 'pending'
  | 'passed'
  | 'failed'
  | 'skipped'

export interface RunTest {
  status: TestStatus
  lane: string
  spec: string
  title: string
  line: number
  durationMs?: number
  /** First line of the failure, when there was one. */
  error?: string
  /** Whether a `failures/<key>.png` of the page it gave up on was taken. */
  failureShot?: boolean
  /** File names of the captures this test took, in order. */
  captures: string[]
}

export type CaptureStatus =
  /** Captured and settled: usable as the next run's baseline. */
  | 'captured'
  /** Captured while still moving, so the picture is not reproducible. */
  | 'unsettled'

export interface RunCapture {
  status: CaptureStatus
  test: string
  sha?: string
  durationMs?: number
  diffPixels?: number
  /** Whether the diff crossed the noise floor; absent when there was nothing to diff against. */
  changed?: boolean
}

export type RunStatus = 'running' | 'complete'

export interface RunManifest {
  /** Sortable and unique: an ISO-ish stamp plus a suffix. */
  runId: string
  startedAt: string
  finishedAt?: string
  status: RunStatus
  /** `HEAD` when the run started, so a baseline can name the build it is. */
  commit: string
  /** Whether the working tree carried uncommitted changes. */
  dirty: boolean
  /** The ref an `--against` capture was taken from; absent for a plain run. */
  ref?: string
  /** What the run was asked for, as the Playwright arguments that narrowed it. */
  filters: string[]
  /** Lane ids this run captures in. */
  lanes: string[]
  /**
   * The runs this manifest was merged from, when one lane's run per job is
   * put back together into one gallery; each keeps its own manifest too.
   */
  merged?: string[]
  /** Every planned test, keyed by its test key. */
  tests: Record<string, RunTest>
  /** Every capture taken so far, keyed by PNG file name. */
  captures: Record<string, RunCapture>
}

export function newRunId(now: Date, suffix: string): string {
  return `${now
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/-\d{3}Z$/, 'Z')}-${suffix}`
}

/** Write the manifest whole, through a temp file so a kill cannot leave it torn. */
export async function writeRun(manifest: RunManifest, runsDir: string): Promise<void> {
  await mkdir(runsDir, { recursive: true })
  const target = join(runsDir, `${manifest.runId}.json`)
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(manifest, null, 2))
  await rename(temporary, target)
}

/** Undefined for a run that was pruned, or a manifest written half-way. */
export async function readRun(runId: string, runsDir: string): Promise<RunManifest | undefined> {
  const target = join(runsDir, `${runId}.json`)
  if (!existsSync(target)) return undefined
  const raw = (await readFile(target, 'utf8')).trim()
  if (raw === '') return undefined
  return JSON.parse(raw) as RunManifest
}

/** Every manifest on disk, newest first. */
export async function listRuns(runsDir: string): Promise<RunManifest[]> {
  if (!existsSync(runsDir)) return []
  const runs: RunManifest[] = []
  for (const entry of await readdir(runsDir)) {
    if (!entry.endsWith('.json')) continue
    const manifest = await readRun(entry.replace(/\.json$/, ''), runsDir)
    if (manifest) runs.push(manifest)
  }
  return runs.sort((a, b) => b.runId.localeCompare(a.runId))
}

/** Drop all but the newest `keep` manifests. The images they name stay in the pool. */
export async function pruneRuns(runsDir: string, keep: number): Promise<void> {
  const runs = await listRuns(runsDir)
  for (const run of runs.slice(keep)) {
    await rm(join(runsDir, `${run.runId}.json`), { force: true })
  }
}

export function runProgress(manifest: RunManifest): {
  done: number
  planned: number
  failed: number
} {
  const tests = Object.values(manifest.tests)
  return {
    done: tests.filter((test) => test.status !== 'pending').length,
    planned: tests.length,
    failed: tests.filter((test) => test.status === 'failed').length,
  }
}

/**
 * One manifest standing for the newest complete run of each lane, so a gallery
 * can be rebuilt from runs that captured one lane each. Tests and captures are
 * keyed by lane, so the union never collides.
 */
export function mergeLatestRuns(runs: RunManifest[]): RunManifest | undefined {
  const complete = runs.filter((run) => run.status === 'complete')
  const newest = complete[0]
  if (!newest) return undefined
  const byLane = new Map<string, RunManifest>()
  for (const run of complete) {
    for (const lane of run.lanes) {
      if (!byLane.has(lane)) byLane.set(lane, run)
    }
  }
  const parts = [...new Set(byLane.values())]
  return {
    ...newest,
    lanes: [...byLane.keys()],
    merged: parts.map((run) => run.runId),
    filters: [...new Set(parts.flatMap((run) => run.filters))],
    tests: Object.assign({}, ...parts.map((run) => run.tests)) as RunManifest['tests'],
    captures: Object.assign({}, ...parts.map((run) => run.captures)) as RunManifest['captures'],
  }
}
