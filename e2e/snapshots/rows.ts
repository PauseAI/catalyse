/**
 * What the gallery shows, read back off the disk layout: every capture with
 * an image in `current/` or `staging/`, and every failed test that took none.
 * Shared by the reporter while a run goes and by the CLI when it rebuilds the
 * page from finished runs.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  BASELINE,
  CURRENT,
  DIFFS,
  laneById,
  laneIndex,
  PREVIOUS,
  sidecarFile,
  STAGING,
  type CaptureMeta,
} from './config'
import type { GalleryRow, ImageProvenance } from './gallery'
import { isRealChange } from './png'
import type { RunManifest } from './runs'

/** What a capture is compared against: the pinned baseline, or the last complete run. */
export function baselinePathFor(file: string): string {
  return existsSync(BASELINE) ? path.join(PREVIOUS, file) : path.join(CURRENT, file)
}

export async function readMeta(pngPath: string): Promise<CaptureMeta | undefined> {
  const metaPath = sidecarFile(pngPath)
  try {
    return JSON.parse(await readFile(metaPath, 'utf8')) as CaptureMeta
  } catch (error) {
    // Another lane's process may move or still be writing the file; the next
    // rebuild sees it where and as it landed.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
      return undefined
    }
    throw error
  }
}

function provenance(meta: CaptureMeta | undefined, manifest: RunManifest): ImageProvenance {
  return {
    runId: meta?.runId,
    commit: meta?.commit,
    dirty: meta?.dirty ?? false,
    ref: meta?.ref,
    thisRun:
      meta?.runId !== undefined &&
      (meta.runId === manifest.runId || (manifest.merged ?? []).includes(meta.runId)),
  }
}

export async function galleryRows(manifest: RunManifest): Promise<GalleryRow[]> {
  const rows: GalleryRow[] = []
  const seen = new Set<string>()
  for (const dir of [STAGING, CURRENT]) {
    if (!existsSync(dir)) continue
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.png') || seen.has(file)) continue
      seen.add(file)
      const row = await captureRow(file, dir === STAGING, manifest)
      if (row) rows.push(row)
    }
  }
  for (const [key, test] of Object.entries(manifest.tests)) {
    if (test.status === 'failed' && test.captures.length === 0) rows.push(failureRow(key, manifest))
  }
  return rows.sort(
    (a, b) =>
      laneIndex(a.lane) - laneIndex(b.lane) ||
      a.spec.localeCompare(b.spec) ||
      a.testLine - b.testLine ||
      a.testKey.localeCompare(b.testKey) ||
      a.seq - b.seq,
  )
}

async function captureRow(
  file: string,
  staged: boolean,
  manifest: RunManifest,
): Promise<GalleryRow | undefined> {
  const currentPath = path.join(staged ? STAGING : CURRENT, file)
  const previousPath = staged ? baselinePathFor(file) : path.join(PREVIOUS, file)
  const meta = await readMeta(currentPath)
  if (!meta || laneIndex(meta.lane) < 0) return undefined
  const lane = laneById(meta.lane)
  const test = manifest.tests[meta.key]
  const inRun = test !== undefined && test.status !== 'pending'
  const hasPrevious = meta.hasPrevious ?? existsSync(previousPath)
  const changed = hasPrevious && meta.diff !== undefined && isRealChange(meta.diff)
  const previousMeta = hasPrevious ? await readMeta(previousPath) : undefined
  return {
    id: file.replace(/\.png$/, ''),
    lane: lane.id,
    laneLabel: lane.label,
    viewport: lane.viewport,
    theme: lane.theme,
    spec: meta.spec,
    test: meta.test,
    describe: meta.titlePath.slice(0, -1).join(' › '),
    title: meta.titlePath.at(-1) ?? meta.test,
    testKey: meta.key,
    testLine: meta.testLine,
    seq: meta.seq,
    label: meta.label,
    path: meta.path,
    file,
    hasCurrent: true,
    hasPrevious,
    changed,
    diffPixels: meta.diffPixels ?? 0,
    durationMs: meta.durationMs,
    previousTimestamp: previousMeta?.capturedAt,
    currentTimestamp: meta.capturedAt,
    bbox: meta.diff?.bbox ?? undefined,
    hasDiff: existsSync(path.join(DIFFS, file)),
    currentSrc: `${staged ? 'staging' : 'current'}/${file}`,
    previousSrc: `${path.basename(path.dirname(previousPath))}/${file}`,
    currentRun: provenance(meta, manifest),
    previousRun: provenance(previousMeta, manifest),
    testStatus: inRun ? test.status : undefined,
    unsettled: !meta.settled,
    testError: inRun ? test.error : undefined,
    failureSrc: inRun && test.failureShot ? `failures/${meta.key}.png` : undefined,
  }
}

function failureRow(key: string, manifest: RunManifest): GalleryRow {
  const test = manifest.tests[key]
  const lane = laneById(test.lane)
  const none: ImageProvenance = { dirty: false, thisRun: false }
  return {
    id: key,
    lane: lane.id,
    laneLabel: lane.label,
    viewport: lane.viewport,
    theme: lane.theme,
    spec: test.spec,
    test: test.title,
    describe: test.title.split(' › ').slice(0, -1).join(' › '),
    title: test.title.split(' › ').at(-1) ?? test.title,
    testKey: key,
    testLine: test.line,
    seq: 0,
    label: 'no capture',
    path: '',
    hasCurrent: false,
    hasPrevious: false,
    changed: false,
    diffPixels: 0,
    hasDiff: false,
    currentRun: none,
    previousRun: none,
    testStatus: 'failed',
    unsettled: false,
    testError: test.error,
    failureSrc: test.failureShot ? `failures/${key}.png` : undefined,
  }
}
