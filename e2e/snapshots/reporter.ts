/**
 * The runner-side half of a snapshot run. Playwright drives the tests; this
 * reporter plans the run, files each capture the workers stage, diffs it
 * against the last run's, and keeps the gallery up to date as it goes.
 */
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  BASELINE,
  CURRENT,
  DIFFS,
  FAILURES,
  GALLERY,
  historyFile,
  laneIndex,
  LATEST,
  POOL,
  PREVIOUS,
  RUNS,
  sidecarFile,
  SNAPSHOT_ROOT,
  specId,
  STAGING,
  testKey,
} from './config'
import { renderGallery, type RunCost } from './gallery'
import { baselinePathFor, galleryRows, readMeta } from './rows'
import {
  analyzeImages,
  appendHistory,
  decodePng,
  encodePng,
  ingestToPool,
  isRealChange,
  pngSha,
  readBaseline,
  renderDiffImage,
} from './png'
import {
  newRunId,
  pruneRuns,
  runProgress,
  writeRun,
  type RunManifest,
  type TestStatus,
} from './runs'

/** How many run manifests to keep. A few KB each; the images live in the pool. */
const RUNS_KEPT = 50
/** How often the gallery is rewritten while a run is still capturing. */
const PROGRESS_EVERY_MS = 10_000

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/** Describe titles between the file and the test, the way the worker's testInfo lists them. */
function titlePathOf(test: TestCase): string[] {
  const titles = [test.title]
  for (let suite: Suite | undefined = test.parent; suite?.type === 'describe'; suite = suite.parent) {
    titles.unshift(suite.title)
  }
  return titles
}

function keyOf(test: TestCase): string {
  const project = test.parent.project()
  return testKey(project?.name ?? '', test.location.file, titlePathOf(test))
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.split('\n')[0] ?? ''
}

export default class SnapshotReporter implements Reporter {
  private manifest!: RunManifest
  private startedAt = 0
  private captured = { captures: 0, ms: 0 }
  private queue: Promise<void> = Promise.resolve()
  private renderedAt = 0
  private unsettled: string[] = []

  printsToStdio(): boolean {
    return false
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.startedAt = Date.now()
    const tests = suite.allTests()
    const lanes = [...new Set(tests.map((test) => test.parent.project()?.name ?? ''))].filter(
      (lane) => laneIndex(lane) >= 0,
    )
    const filters = process.argv
      .slice(2)
      .filter((arg) => !arg.startsWith('--reporter') && !arg.startsWith('--config'))
    this.manifest = {
      runId: newRunId(new Date(), randomUUID().slice(0, 4)),
      startedAt: new Date().toISOString(),
      status: 'running',
      commit: git('rev-parse --short HEAD') || 'unknown',
      dirty: git('status --porcelain') !== '',
      filters,
      lanes,
      tests: Object.fromEntries(
        tests.map((test) => [
          keyOf(test),
          {
            status: 'pending' as TestStatus,
            lane: test.parent.project()?.name ?? '',
            spec: specId(test.location.file),
            title: titlePathOf(test).join(' › '),
            line: test.location.line,
            captures: [],
          },
        ]),
      ),
      captures: {},
    }
    // Synchronous, because the workers start staging captures the moment
    // this returns, and the directory they write to must already be clean.
    this.resetDirectories()
    this.queue = this.queue.then(async () => {
      await writeRun(this.manifest, RUNS)
      await this.showProgress(true)
    })
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.queue = this.queue.then(() => this.fileTest(test, result)).catch((error: unknown) => {
      console.error(`[snapshots] ${firstLine(error)}`)
    })
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    await this.queue
    this.manifest.status = 'complete'
    this.manifest.finishedAt = new Date().toISOString()
    await this.commitRun()
    await writeRun(this.manifest, RUNS)
    await writeFile(LATEST, JSON.stringify(this.manifest, null, 2))
    await pruneRuns(RUNS, RUNS_KEPT)
    await this.showProgress(true)
    const { failed } = runProgress(this.manifest)
    const changed = Object.values(this.manifest.captures).filter(
      (capture) => capture.changed === true,
    ).length
    console.log(
      `\n[snapshots] ${String(this.captured.captures)} captures, ${String(changed)} changed, ${String(failed)} tests failed. Gallery: ${GALLERY}`,
    )
    if (this.unsettled.length > 0) {
      console.log(
        `[snapshots] Still moving after the settle window, so shot mid-flight and not reproducible:\n  ${this.unsettled.join('\n  ')}`,
      )
    }
    return result.status === 'passed' ? undefined : { status: result.status }
  }

  /**
   * Prepare the directories for a run. Nothing rotates here, because a run's
   * captures only reach `current/` at the end; what this clears is the
   * wreckage of a run that never got that far.
   */
  private resetDirectories(): void {
    for (const dir of [SNAPSHOT_ROOT, PREVIOUS, CURRENT, DIFFS, POOL, RUNS, FAILURES]) {
      mkdirSync(dir, { recursive: true })
    }
    // Only this run's lanes: another lane's process may be staging already.
    mkdirSync(STAGING, { recursive: true })
    const mine = (entry: string) => this.manifest.lanes.some((lane) => entry.startsWith(`${lane}--`))
    for (const entry of readdirSync(STAGING)) {
      if (!mine(entry)) continue
      rmSync(path.join(DIFFS, entry), { force: true })
      rmSync(path.join(STAGING, entry), { force: true })
    }
    // A failure shot is only ever this run's; last run's would read as today's.
    for (const key of Object.keys(this.manifest.tests)) {
      rmSync(path.join(FAILURES, `${key}.png`), { force: true })
    }
  }

  private async fileTest(test: TestCase, result: TestResult): Promise<void> {
    const key = keyOf(test)
    const entry = this.manifest.tests[key]
    if (!entry) return
    entry.status =
      result.status === 'passed'
        ? 'passed'
        : result.status === 'skipped'
          ? 'skipped'
          : 'failed'
    entry.durationMs = result.duration
    if (result.error) entry.error = firstLine(result.error.message ?? result.error)
    entry.failureShot = existsSync(path.join(FAILURES, `${key}.png`))
    const staged = (await readdir(STAGING))
      .filter((name) => name.startsWith(`${key}--`) && name.endsWith('.png'))
      .sort()
    for (const file of staged) {
      await this.fileCapture(file, key)
    }
    await writeRun(this.manifest, RUNS)
    await this.showProgress(false)
  }

  /**
   * Diff a staged capture against this run's baseline, complete its sidecar,
   * and pool it. The numbers are cached once here, so every later gallery
   * build reads them instead of decoding both PNGs again.
   */
  private async fileCapture(file: string, key: string): Promise<void> {
    const stagedPath = path.join(STAGING, file)
    const meta = await readMeta(stagedPath)
    if (!meta) return
    const buffer = await readFile(stagedPath)
    const sha = pngSha(buffer)
    const previousPath = baselinePathFor(file)
    const hasPrevious = existsSync(previousPath)
    let diffPixels = 0
    let changed: boolean | undefined
    if (hasPrevious) {
      const prevImage = decodePng(await readFile(previousPath))
      const currImage = decodePng(buffer)
      const diff = analyzeImages(prevImage, currImage)
      meta.diff = diff
      diffPixels = diff.count
      changed = isRealChange(diff)
      const diffPath = path.join(DIFFS, file)
      if (diff.count > 0) {
        await writeFile(diffPath, encodePng(renderDiffImage(prevImage, currImage)))
      } else {
        await rm(diffPath, { force: true })
      }
    }
    meta.sha = sha
    meta.hasPrevious = hasPrevious
    meta.diffPixels = diffPixels
    meta.runId = this.manifest.runId
    meta.commit = this.manifest.commit
    meta.dirty = this.manifest.dirty
    await writeFile(`${sidecarFile(stagedPath)}.tmp`, JSON.stringify(meta, null, 2))
    await rename(`${sidecarFile(stagedPath)}.tmp`, sidecarFile(stagedPath))
    await ingestToPool(buffer, POOL)
    await appendHistory(file, sha, undefined, historyFile(meta.lane))
    this.manifest.captures[file] = {
      status: meta.settled ? 'captured' : 'unsettled',
      test: key,
      sha,
      durationMs: meta.durationMs,
      diffPixels,
      changed,
    }
    this.manifest.tests[key]?.captures.push(file)
    this.captured.captures += 1
    this.captured.ms += meta.durationMs
    if (!meta.settled) this.unsettled.push(file)
  }

  /**
   * Move a finished run's captures into place: the images they replace step
   * back to `previous/`, the new ones take `current/`. A pinned baseline is
   * not rotated, since `previous/` holds the ref's captures until the pin is
   * cleared; there the staged frames simply become `current/`.
   */
  private async commitRun(): Promise<void> {
    const rotate = !existsSync(BASELINE)
    const kept: string[] = []
    for (const [file, capture] of Object.entries(this.manifest.captures)) {
      // A picture from a test that failed is worth looking at and worth
      // nothing as a baseline: it stays in staging for this gallery, and the
      // last good picture keeps `current/`.
      if (this.manifest.tests[capture.test]?.status === 'failed') {
        kept.push(file, sidecarFile(file))
        continue
      }
      for (const name of [file, sidecarFile(file)]) {
        const staged = path.join(STAGING, name)
        if (!existsSync(staged)) continue
        const current = path.join(CURRENT, name)
        if (rotate && existsSync(current)) {
          await rm(path.join(PREVIOUS, name), { force: true })
          await rename(current, path.join(PREVIOUS, name))
        }
        await rm(current, { force: true })
        await rename(staged, current)
      }
    }
    const mine = (entry: string) => this.manifest.lanes.some((lane) => entry.startsWith(`${lane}--`))
    for (const entry of await readdir(STAGING)) {
      if (mine(entry) && !kept.includes(entry)) await rm(path.join(STAGING, entry), { force: true })
    }
  }

  private async showProgress(force: boolean): Promise<void> {
    if (!force && Date.now() - this.renderedAt < PROGRESS_EVERY_MS) return
    this.renderedAt = Date.now()
    const cost: RunCost = { ...this.captured, wallMs: Date.now() - this.startedAt }
    const html = renderGallery(await galleryRows(this.manifest), this.manifest, await readBaseline(BASELINE), cost)
    await writeFile(GALLERY, html)
  }
}
