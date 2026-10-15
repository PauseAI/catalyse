/**
 * Taking one picture from inside a test: settle the page, hold its moving
 * parts still, shoot it full-page into `staging/` and leave a sidecar saying
 * what it is. The reporter, in the runner process, diffs and files it.
 */
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  captureFile,
  FAILURES,
  laneById,
  sidecarFile,
  specId,
  STAGING,
  testKey,
  type CaptureMeta,
  type Lane,
} from './config'
import { analyzeImages, decodePng, isRealChange, type DecodedImage } from './png'

/**
 * How long the full-page frame must stay identical before the shot is taken.
 * Two identical frames are not enough on their own: a transient that pauses
 * (a spinner between two of its frames, a toast on its way out) satisfies
 * them mid-flight, so the hold must outlast the longest such pause.
 */
const STABLE_HOLD_MS = knob('SNAPSHOT_HOLD_MS', 400)
const STABLE_POLL_MS = 100
/** Painted frames the hold must also span, so a starved page cannot pass by not drawing. */
const STABLE_FRAMES = knob('SNAPSHOT_FRAMES', 4)
/**
 * A page still moving after this long is shot anyway and reported as
 * unsettled; a loaded machine that manages fewer polls than the minimum in
 * that time gets the extra looks, since one slow screenshot is not movement.
 */
const STABLE_CAP_MS = 6_000
const STABLE_MIN_POLLS = 8
/** After the poll says still, one more beat for the compositor to catch up. */
const RASTER_SETTLE_MS = knob('SNAPSHOT_RASTER_MS', 150)
/**
 * How long to give the network to go quiet before the frame poll starts; 0
 * skips the wait. Off by default: the frame poll already waits for whatever
 * a late response draws, and a page with a long poll open never goes idle,
 * so the wait only ever ran out its clock.
 */
const NETWORK_IDLE_MS = knob('SNAPSHOT_NETWORK_IDLE_MS', 0)

/** A timing the environment may override, for measuring one setting against another. */
function knob(name: string, fallback: number): number {
  const value = process.env[name]
  return value === undefined ? fallback : parseInt(value, 10)
}

/**
 * The instant every date on a page is rewritten to before the shot. Records
 * are created by the test seconds before they are photographed, so what a
 * page shows is the wall clock, and two runs of the same code a day apart
 * differ in every date. The values are replaced in the rendered text alone;
 * the data underneath is untouched.
 */
export const SNAPSHOT_DATE = {
  long: '12 September 2026',
  short: '12 Sep 2026',
  time: '10:30',
  relative: '3 mins ago',
  input: '2026-09-12',
}

/**
 * What the lane asks of every document it loads. The theme is stored where
 * the app's own provider reads it, so the page boots straight into it. The
 * caret, scrollbars, transitions and the spell checker's underline are each
 * something a run cannot control and the picture must not carry.
 */
export function snapshotInitScript(lane: Lane): { theme: string; css: string } {
  return {
    theme: lane.theme,
    css: `
      * { caret-color: transparent !important; }
      * { scrollbar-width: none !important; }
      *::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      *, *::before, *::after { transition: none !important; animation: none !important; }
      html.snapshot-final [role="alert"] { display: none !important; }
      /* A dotted underline's dot phase drifts a pixel with subpixel text position. */
      * { text-decoration-style: solid !important; }
    `,
  }
}

/** Runs in the browser before any of the page's own scripts. */
function installSnapshotPage(options: { theme: string; css: string }): void {
  localStorage.setItem('theme', options.theme)
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      const style = document.createElement('style')
      style.textContent = options.css
      document.head.append(style)
      document.documentElement.spellcheck = false
    },
    { once: true },
  )
  // Anything that samples Math.random comes out identical every run.
  let seed = 0x2545f491
  Math.random = (): number => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Make every page a context opens capture the same way, whichever test opened it. */
export async function prepareSnapshotContext(context: BrowserContext, lane: Lane): Promise<void> {
  await context.addInitScript(installSnapshotPage, snapshotInitScript(lane))
}

export function laneFor(testInfo: TestInfo): Lane {
  return laneById(testInfo.project.name)
}

export function keyFor(testInfo: TestInfo): string {
  return testKey(testInfo.project.name, testInfo.file, testInfo.titlePath.slice(1))
}

async function paintedFrames(page: Page, budgetMs: number): Promise<number> {
  return page.evaluate(
    (budget) =>
      new Promise<number>((resolve) => {
        let painted = 0
        const deadline = performance.now() + budget
        const tick = (): void => {
          painted += 1
          if (performance.now() >= deadline) {
            resolve(painted)
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        setTimeout(() => resolve(painted), budget * 2)
      }),
    budgetMs,
  )
}

/**
 * Hold until the rendered page has stopped changing, so the shot is
 * deterministic. `networkidle` is not enough on its own: hydration swaps a
 * placeholder for the real header, a toast fades, a list re-sorts once its
 * data arrives. Watching the whole frame catches all of it without knowing
 * any of it. Returns whether the page settled inside the cap.
 */
export async function waitForPageStable(page: Page): Promise<boolean> {
  let previous: DecodedImage | null = null
  let lastChange = Date.now()
  let framesHeld = 0
  const start = Date.now()
  for (let polls = 0; Date.now() - start < STABLE_CAP_MS || polls < STABLE_MIN_POLLS; polls++) {
    // Polled at CSS scale to keep each frame cheap, and judged by the same
    // noise floor as the gallery's own comparison: a frame that would read
    // as "same" on the page is still enough.
    const frame = decodePng(
      await page.screenshot({ fullPage: true, animations: 'disabled', scale: 'css' }),
    )
    if (previous === null || isRealChange(analyzeImages(previous, frame))) {
      previous = frame
      lastChange = Date.now()
      framesHeld = 0
    } else if (Date.now() - lastChange >= STABLE_HOLD_MS && framesHeld >= STABLE_FRAMES) {
      return true
    }
    framesHeld += await paintedFrames(page, STABLE_POLL_MS)
  }
  return false
}

/**
 * Rewrite every date the page shows to {@link SNAPSHOT_DATE}, in text nodes
 * and in date inputs. The patterns are the ones `lib/format-date.ts` produces.
 */
declare global {
  interface Window {
    __snapshotNormaliser?: MutationObserver
  }
}

export async function normaliseDates(page: Page): Promise<void> {
  await page.evaluate((fixed) => {
    const months =
      '(January|February|March|April|May|June|July|August|September|October|November|December)'
    const shortMonths = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)'
    const rules: [RegExp, string][] = [
      [new RegExp(`\\b\\d{1,2} ${months} \\d{4}(?:,? (?:at )?\\d{1,2}:\\d{2})`, 'g'), `${fixed.long}, ${fixed.time}`],
      [new RegExp(`\\b\\d{1,2} ${months} \\d{4}\\b`, 'g'), fixed.long],
      [new RegExp(`\\b\\d{1,2} ${shortMonths} \\d{4}\\b`, 'g'), fixed.short],
      [new RegExp(`\\b${months} \\d{4}\\b`, 'g'), fixed.long.slice(3)],
      [/\b\d{4}-\d{2}-\d{2}\b/g, fixed.input],
      [/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, '12/09/2026'],
      [/\bjust now\b/g, fixed.relative],
      // A measured duration, such as a job's run time, is wall clock too.
      [/\b\d+(?:\.\d+)?(?:ms|s|m)\b(?=\s|$|<)/g, '100ms'],
      // A countdown ticks once a second, and a shot lands either side of a tick.
      [/\b\d{1,2}:\d{2} left\b/g, '20:00 left'],
      [/\b\d+ (?:min|mins|hour|hours|day|days) ago\b/g, fixed.relative],
      [/\b(?:in|In) \d+ (?:min|mins|hour|hours|day|days)\b/g, 'in 3 days'],
    ]
    const normalise = (node: Text) => {
      let text = node.data
      for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement)
      if (text !== node.data) node.data = text
    }
    const normaliseTree = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node as Text)
      }
      nodes.forEach(normalise)
    }
    normaliseTree(document.body)
    // A countdown or a relative time re-renders on its own timer, and a tick
    // between here and the shot would put the live value back; the observer
    // rewrites it again before the frame paints.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') normalise(m.target as Text)
        for (const added of m.addedNodes) normaliseTree(added)
      }
    })
    observer.observe(document.body, { characterData: true, childList: true, subtree: true })
    window.__snapshotNormaliser?.disconnect()
    window.__snapshotNormaliser = observer
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="date"]')) {
      if (input.value) input.value = fixed.input
    }
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')) {
      if (input.value) input.value = `${fixed.input}T${fixed.time}`
    }
  }, SNAPSHOT_DATE)
}

/** Everything a capture waits for before the page is judged still. */
async function settle(page: Page): Promise<boolean> {
  await page.evaluate(() => document.fonts.ready)
  if (NETWORK_IDLE_MS > 0) {
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_MS }).catch(() => undefined)
  }
  // A full-page shot resizes the viewport to the document, and on a page
  // scrolled part-way down the sticky header lands somewhere different in
  // each frame while the scroll position is restored. From the top there is
  // nothing to restore, and the picture is the page as a reader first meets
  // it. A modal's own scrolling body is the same problem one level down.
  await page.evaluate(() => {
    scrollTo(0, 0)
    for (const element of document.querySelectorAll<HTMLElement>('*')) {
      if (element.scrollTop > 0) element.scrollTop = 0
    }
  })
  // The pointer stays where the last click left it, and whatever the next
  // page puts under that spot shows its hover colour.
  await page.mouse.move(0, 0)
  const settled = await waitForPageStable(page)
  await normaliseDates(page)
  await page.waitForTimeout(RASTER_SETTLE_MS)
  return settled
}

/**
 * Shoot the page into `staging/` as capture `seq` of this test, and write the
 * sidecar the reporter completes. Returns the file name.
 */
export interface CaptureOptions {
  /**
   * Take toasts off the page before the shot. A final frame is taken at
   * whatever moment the test happened to end, and a toast on a four second
   * timer is on screen in one run and gone in the next; nothing about the
   * test's outcome lives in it. A picture a test asks for mid-flow keeps
   * its toasts, since that may be what the test is showing.
   */
  dismissToasts?: boolean
}

export async function captureSnapshot(
  page: Page,
  testInfo: TestInfo,
  seq: number,
  label: string,
  options: CaptureOptions = {},
): Promise<string> {
  const started = Date.now()
  // A class on the root rather than removing the element: the app renders
  // its toasts from state and would put a removed one straight back.
  await page.evaluate((final) => {
    document.documentElement.classList.toggle('snapshot-final', final)
  }, options.dismissToasts === true)
  const lane = laneFor(testInfo)
  const key = keyFor(testInfo)
  const file = captureFile(key, seq, label)
  const settled = await settle(page)
  await mkdir(STAGING, { recursive: true })
  await page.screenshot({
    path: path.join(STAGING, file),
    fullPage: true,
    animations: 'disabled',
  })
  // The test goes on from here and may read a date the page shows.
  await page.evaluate(() => window.__snapshotNormaliser?.disconnect())
  const meta: CaptureMeta = {
    lane: lane.id,
    spec: specId(testInfo.file),
    specFile: path.relative(testInfo.project.testDir, testInfo.file),
    test: testInfo.titlePath.slice(1).join(' › '),
    titlePath: testInfo.titlePath.slice(1),
    testLine: testInfo.line,
    key,
    seq,
    label,
    path: new URL(page.url()).pathname,
    capturedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    settled,
    viewport: {
      id: lane.viewport,
      width: lane.width,
      height: lane.height,
      deviceScaleFactor: lane.deviceScaleFactor,
    },
    theme: lane.theme,
  }
  // Through a rename, so a reporter in another lane's process never reads
  // a sidecar part-way through being written.
  const sidecar = path.join(STAGING, sidecarFile(file))
  await writeFile(`${sidecar}.tmp`, JSON.stringify(meta, null, 2))
  await rename(`${sidecar}.tmp`, sidecar)
  return file
}

/**
 * Photograph the page a failed test gave up on. A diagnosis, never a
 * baseline: it lives in `failures/` and is replaced the next time the test
 * runs, whatever the outcome.
 */
export async function captureFailure(page: Page, testInfo: TestInfo): Promise<boolean> {
  if (page.isClosed() || !page.url().startsWith('http')) return false
  await mkdir(FAILURES, { recursive: true })
  const target = path.join(FAILURES, `${keyFor(testInfo)}.png`)
  try {
    await page.screenshot({ path: target, fullPage: true, animations: 'disabled', timeout: 10_000 })
  } catch {
    return existsSync(target)
  }
  return true
}
