/**
 * What a snapshot run is made of: the lanes it captures in, where its files
 * live, and how a capture is named. Shared by the fixtures (in the worker),
 * the reporter (in the runner) and the CLI, so all three agree on a file name
 * without talking to each other.
 */
import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import path from 'node:path'

/** Whether this Playwright run is capturing snapshots at all. */
export const SNAPSHOTS_ENABLED = process.env.SNAPSHOTS === '1'

/**
 * Servers a snapshot run may open in all, each with a worker, a browser and
 * a database schema of its own. A server is a whole Next process, so the
 * count follows the machine at one per two cores, capped so a big machine
 * does not ask the database for more connections than it allows.
 */
export function snapshotServerCount(): number {
  if (process.env.SNAPSHOT_WORKERS) return Math.max(1, parseInt(process.env.SNAPSHOT_WORKERS, 10))
  return Math.min(6, Math.max(1, Math.floor(cpus().length / 2)))
}

/**
 * Each lane runs as a Playwright process of its own, so its worker pool never
 * mixes with another lane's and every one of its tests lands on a server in
 * its block. The command in front of the run picks the block and hands it to
 * the process as the first server index and the count; a process started by
 * hand with `SNAPSHOTS=1` gets the whole count from index zero.
 */
export function snapshotBlock(): { first: number; count: number } {
  const first = parseInt(process.env.SNAPSHOT_SERVER_FIRST ?? '0', 10)
  const count = parseInt(process.env.SNAPSHOT_SERVER_COUNT ?? String(snapshotServerCount()), 10)
  return { first, count }
}

/** The server a worker slot uses: its place in this process's block. */
export function snapshotServerIndex(slot: number): number {
  const { first, count } = snapshotBlock()
  return first + (slot % count)
}

export const SNAPSHOT_ROOT = path.resolve(__dirname, '..', '..', 'snapshots')
export const CURRENT = path.join(SNAPSHOT_ROOT, 'current')
export const PREVIOUS = path.join(SNAPSHOT_ROOT, 'previous')
/**
 * Where a run captures to. Nothing moves into `current/` until the run reaches
 * its end, so a run that is killed part-way leaves the last complete run's
 * images standing rather than half-replacing them.
 */
export const STAGING = path.join(SNAPSHOT_ROOT, 'staging')
export const DIFFS = path.join(SNAPSHOT_ROOT, 'diffs')
/**
 * Where a test that failed leaves the page as it stood. Kept out of the
 * staging to current rotation: a picture of a half-driven page is a
 * diagnosis, never a baseline.
 */
export const FAILURES = path.join(SNAPSHOT_ROOT, 'failures')
export const POOL = path.join(SNAPSHOT_ROOT, 'pool')
export const RUNS = path.join(SNAPSHOT_ROOT, 'runs')
/**
 * A capture's timeline, one file per lane: lanes run as processes of their
 * own and a lane's captures are its own, so no two processes write one file.
 */
export function historyFile(laneId: string): string {
  return path.join(SNAPSHOT_ROOT, `history-${laneId}.json`)
}
export const BASELINE = path.join(SNAPSHOT_ROOT, 'baseline.json')
export const GALLERY = path.join(SNAPSHOT_ROOT, 'index.html')
/** The manifest of the last run to finish, for whoever wants the gallery's contents without the page. */
export const LATEST = path.join(SNAPSHOT_ROOT, 'manifest.json')

export type Theme = 'light' | 'dark'

export interface Lane {
  /** Doubles as the Playwright project name. */
  id: string
  label: string
  viewport: 'desktop' | 'mobile'
  viewportLabel: string
  theme: Theme
  width: number
  height: number
  deviceScaleFactor: number
  isMobile: boolean
}

const DESKTOP = { width: 1440, height: 1000, deviceScaleFactor: 1, isMobile: false } as const
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true } as const

/** Every lane a full run captures, in the order the gallery lists them. */
export const LANES: Lane[] = [
  {
    id: 'desktop-light',
    label: 'Desktop · Light',
    viewport: 'desktop',
    viewportLabel: 'Desktop',
    theme: 'light',
    ...DESKTOP,
  },
  {
    id: 'desktop-dark',
    label: 'Desktop · Dark',
    viewport: 'desktop',
    viewportLabel: 'Desktop',
    theme: 'dark',
    ...DESKTOP,
  },
  {
    id: 'mobile-light',
    label: 'Mobile · Light',
    viewport: 'mobile',
    viewportLabel: 'Mobile',
    theme: 'light',
    ...MOBILE,
  },
  {
    id: 'mobile-dark',
    label: 'Mobile · Dark',
    viewport: 'mobile',
    viewportLabel: 'Mobile',
    theme: 'dark',
    ...MOBILE,
  },
]

export function laneById(id: string): Lane {
  const lane = LANES.find((candidate) => candidate.id === id)
  if (!lane) throw new Error(`Unknown snapshot lane: ${id}`)
  return lane
}

export function laneIndex(id: string): number {
  return LANES.findIndex((candidate) => candidate.id === id)
}

/** `e2e/tests/11-dashboard.spec.ts` becomes `11-dashboard`. */
export function specId(file: string): string {
  return path.basename(file).replace(/\.spec\.ts$/, '')
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The part of a file name that identifies one test in one lane. The slug is
 * cut to a readable length, and the hash keeps two tests whose titles share
 * that prefix apart.
 */
export function testKey(laneId: string, file: string, titlePath: string[]): string {
  const title = titlePath.join(' › ')
  const hash = createHash('sha1').update(title).digest('hex').slice(0, 6)
  return `${laneId}--${specId(file)}--${slug(title).slice(0, 60).replace(/-+$/, '')}-${hash}`
}

/** One capture's file name, with its sequence number so the gallery keeps capture order. */
export function captureFile(key: string, seq: number, label: string): string {
  return `${key}--${String(seq).padStart(2, '0')}-${slug(label)}.png`
}

export function sidecarFile(pngFile: string): string {
  return pngFile.replace(/\.png$/, '.json')
}

/** What the worker knows about a capture when it takes it; the reporter adds the rest. */
export interface CaptureMeta {
  lane: string
  spec: string
  specFile: string
  test: string
  titlePath: string[]
  testLine: number
  key: string
  seq: number
  label: string
  /** The page's path when the picture was taken. */
  path: string
  capturedAt: string
  durationMs: number
  /** Whether the page held still before the shot; a false here is reported as unsettled. */
  settled: boolean
  viewport: { id: string; width: number; height: number; deviceScaleFactor: number }
  theme: Theme
  /** Filled in by the reporter once the capture is diffed. */
  sha?: string
  hasPrevious?: boolean
  diffPixels?: number
  diff?: import('./png').DiffAnalysis
  runId?: string
  commit?: string
  dirty?: boolean
  /** The ref an `--against` capture came from. */
  ref?: string
}
