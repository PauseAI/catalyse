/**
 * The page a run leaves behind: every capture beside the picture it replaced,
 * with the changed pixels picked out, and a rail down the side to move
 * through it by lane, spec and test. Pure rendering; the reporter gathers the
 * rows and writes the file.
 */
import type { BaselineFile, DiffBbox } from './png'
import { LANES } from './config'
import { runProgress, type RunManifest, type TestStatus } from './runs'

export interface ImageProvenance {
  runId?: string
  commit?: string
  dirty: boolean
  ref?: string
  thisRun: boolean
}

/** One row of the gallery: a capture, or a failed test that took none. */
export interface GalleryRow {
  id: string
  lane: string
  laneLabel: string
  viewport: string
  theme: string
  spec: string
  /** The full test name, describe blocks included. */
  test: string
  /** The describe blocks alone, joined; empty for a test outside any. */
  describe: string
  /** The test's own title. */
  title: string
  testKey: string
  testLine: number
  seq: number
  label: string
  path: string
  file?: string
  hasCurrent: boolean
  hasPrevious: boolean
  changed: boolean
  diffPixels: number
  durationMs?: number
  previousTimestamp?: string
  currentTimestamp?: string
  bbox?: DiffBbox
  hasDiff: boolean
  currentSrc?: string
  previousSrc?: string
  currentRun: ImageProvenance
  previousRun: ImageProvenance
  /** How this run left the test that took it, if it was in this run. */
  testStatus?: TestStatus
  /** Whether the page was still moving when the shot was taken. */
  unsettled: boolean
  testError?: string
  failureSrc?: string
}

export interface RunCost {
  captures: number
  ms: number
  wallMs: number
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function runLabel(run: ImageProvenance): string {
  if (run.ref !== undefined) {
    return `<span class="run ref">${escapeHtml(run.ref)}${run.commit === undefined ? '' : `@${escapeHtml(run.commit)}`}</span> `
  }
  if (run.thisRun) return `<span class="run now">this run</span> `
  if (run.commit === undefined) return ''
  return `<span class="run">${escapeHtml(run.commit)}${run.dirty ? '+' : ''}</span> `
}

function rowBadge(row: GalleryRow): string {
  if (row.testStatus === undefined) return `<span class="mark carried">not in this run</span>`
  if (row.testStatus === 'failed') {
    return `<span class="mark bad" title="${escapeHtml(row.testError ?? '')}">test failed</span>`
  }
  if (row.unsettled) return `<span class="mark bad">unsettled</span>`
  return ''
}

function runBanner(manifest: RunManifest, baseline: BaselineFile | undefined, cost: RunCost): string {
  const { done, planned, failed } = runProgress(manifest)
  const running = manifest.status === 'running'
  const remaining = done === 0 ? undefined : (planned - done) * (cost.wallMs / done)
  const against =
    baseline === undefined ? 'the run before it' : `${baseline.ref} (${baseline.sha.slice(0, 7)})`
  const bar = running
    ? `<div class="bar"><i style="width:${String(Math.round((done / Math.max(planned, 1)) * 100))}%"></i></div>`
    : ''
  const eta =
    running && remaining !== undefined
      ? ` · about ${escapeHtml(formatDuration(remaining))} left`
      : ''
  const scope =
    manifest.filters.length === 0 ? 'whole suite' : escapeHtml(manifest.filters.join(' '))
  return `<div class="run-banner${running ? ' running' : ''}">
    <p><b>${running ? 'Capturing…' : 'Run of'} ${escapeHtml(formatTimestamp(manifest.startedAt))}</b>
      · ${escapeHtml(manifest.commit)}${manifest.dirty ? '+ (uncommitted changes)' : ''}
      · diffed against ${escapeHtml(against)}</p>
    <p>${String(done)}/${String(planned)} tests${failed === 0 ? '' : ` · <b class="bad">${String(failed)} failed</b>`} · ${manifest.lanes.join(', ')} · ${scope}${eta}. Every other row on this page was captured by an earlier run.</p>
    ${bar}
  </div>`
}

function buildList(commits: Set<string>): string {
  const named = [...commits].filter((commit) => commit !== 'unknown')
  const parts = [...named]
  if (commits.size > named.length) parts.push('captures from before the build was recorded')
  return escapeHtml(parts.join(', '))
}

function mixedBaselineBanner(rows: GalleryRow[]): string {
  const commits = new Set(
    rows
      .filter((row) => row.hasPrevious && row.testStatus !== undefined)
      .map((row) => row.previousRun.commit ?? 'unknown'),
  )
  if (commits.size < 2) return ''
  return `<div class="baseline-banner" data-when="this">The rows below are diffed against pictures from ${String(commits.size)} builds (${buildList(commits)}). Each row's "Previous" caption says which one it is. A diff across two builds says nothing on its own.</div>`
}

function mixedCurrentBanner(rows: GalleryRow[]): string {
  const commits = new Set(rows.map((row) => row.currentRun.commit ?? 'unknown'))
  if (commits.size < 2) return ''
  return `<div class="baseline-banner" data-when="all">Showing every row, so these pictures come from ${String(commits.size)} builds (${buildList(commits)}) and several runs. The rows marked <b>carried</b> were captured by an earlier run. Switch to <b>This run</b> for what was just captured.</div>`
}

function figure(caption: string, src: string, alt: string, provenance: string, timestamp?: string): string {
  const time =
    timestamp === undefined
      ? ''
      : `<time datetime="${timestamp}">${escapeHtml(formatTimestamp(timestamp))}</time>`
  return `<figure><figcaption>${caption} ${provenance}${time}</figcaption><a href="${src}"><img loading="lazy" src="${src}" alt="${escapeHtml(alt)}" /></a></figure>`
}

/** The rows that are one capture across lanes: same spec, test and label. */
interface RowGroup {
  id: string
  spec: string
  describe: string
  title: string
  testKey: string
  testLine: number
  seq: number
  label: string
  rows: GalleryRow[]
}

/** A key that names a capture without its lane, so lanes of one capture group. */
function groupKey(row: GalleryRow): string {
  return `${row.spec}|${row.testKey.replace(/^[^-]+-[^-]+--/, '')}|${String(row.seq)}|${row.label}`
}

function groupRows(rows: GalleryRow[]): RowGroup[] {
  const groups = new Map<string, RowGroup>()
  for (const row of rows) {
    const key = groupKey(row)
    let group = groups.get(key)
    if (!group) {
      group = {
        id: `row-${slugId(key)}`,
        spec: row.spec,
        describe: row.describe,
        title: row.title,
        testKey: row.testKey.replace(/^[^-]+-[^-]+--/, ''),
        testLine: row.testLine,
        seq: row.seq,
        label: row.label,
        rows: [],
      }
      groups.set(key, group)
    }
    group.rows.push(row)
  }
  return [...groups.values()]
}

function slugId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** What a row is, over all its lanes: the worst state any lane is in. */
type GroupState = 'failed' | 'unsettled' | 'changed' | 'new' | 'same'

/** The worst state any lane of the row is in. A first capture is new, not changed. */
function groupState(group: RowGroup): GroupState {
  if (group.rows.some((row) => row.testStatus === 'failed')) return 'failed'
  if (group.rows.some((row) => row.unsettled)) return 'unsettled'
  if (group.rows.some((row) => row.changed)) return 'changed'
  if (group.rows.some((row) => !row.hasPrevious)) return 'new'
  return 'same'
}

function lanePane(row: GalleryRow): string {
  const previous =
    row.hasPrevious && row.previousSrc !== undefined
      ? figure(
          'Previous',
          row.previousSrc,
          `${row.label} previous`,
          runLabel(row.previousRun),
          row.previousTimestamp,
        )
      : `<figure class="missing"><figcaption>Previous</figcaption><div>No previous run</div></figure>`
  const current =
    row.hasCurrent && row.currentSrc !== undefined
      ? figure(
          'Current',
          row.currentSrc,
          `${row.label} current`,
          runLabel(row.currentRun),
          row.currentTimestamp,
        )
      : `<figure class="missing"><figcaption>Current</figcaption><div>Never captured</div></figure>`
  const status = !row.hasPrevious
    ? 'New'
    : row.changed
      ? `Changed · ${String(row.diffPixels)}px`
      : row.diffPixels > 0
        ? `Same · ±${String(row.diffPixels)}px noise`
        : 'Unchanged'
  const timing =
    row.durationMs === undefined
      ? ''
      : `<span class="timing">${escapeHtml(formatDuration(row.durationMs))}</span>`
  const diffFigure =
    row.hasDiff && row.file !== undefined
      ? `<figure class="diff"><figcaption>Diff${row.bbox ? ` · bbox (${String(row.bbox.x0)},${String(row.bbox.y0)})–(${String(row.bbox.x1)},${String(row.bbox.y1)})` : ''}</figcaption><a href="diffs/${row.file}"><img loading="lazy" src="diffs/${row.file}" alt="${escapeHtml(row.label)} diff" /></a></figure>`
      : ''
  const failureFigure =
    row.failureSrc === undefined
      ? ''
      : `<figure class="failed"><figcaption>Where it gave up</figcaption><a href="${row.failureSrc}"><img loading="lazy" src="${row.failureSrc}" alt="${escapeHtml(row.test)} at the point it failed" /></a></figure>`
  const failureNote =
    row.testError === undefined ? '' : `<p class="failure">${escapeHtml(row.testError)}</p>`
  const columns = 2 + [diffFigure, failureFigure].filter((part) => part !== '').length
  return `<div class="pane" data-lane="${escapeHtml(row.lane)}" data-viewport="${escapeHtml(row.viewport)}" data-theme="${escapeHtml(row.theme)}" data-changed="${String(row.changed)}" data-run="${row.testStatus === undefined ? 'other' : 'this'}">
      <div class="pane-head"><p><code>${escapeHtml(row.path)}</code></p><div class="badges">${rowBadge(row)}${timing}<span>${status}</span></div></div>
      ${failureNote}
      <div class="shots" style="grid-template-columns: repeat(${String(columns)}, minmax(0, 1fr))">
        ${previous}
        ${current}
        ${diffFigure}
        ${failureFigure}
      </div>
    </div>`
}

function rowSection(group: RowGroup): string {
  const lanes = group.rows.map((row) => row.lane)
  const changedLanes = group.rows.filter((row) => row.changed).map((row) => row.lane)
  const anyThisRun = group.rows.some((row) => row.testStatus !== undefined)
  return `<section id="${group.id}" data-spec="${escapeHtml(group.spec)}" data-state="${groupState(group)}" data-lanes="${escapeHtml(lanes.join(' '))}" data-changed-lanes="${escapeHtml(changedLanes.join(' '))}" data-run="${anyThisRun ? 'this' : 'other'}" data-text="${escapeHtml(`${group.spec} ${group.describe} ${group.title} ${group.label}`.toLowerCase())}">
    <header>
      <div><p>${escapeHtml(group.spec)}${group.describe === '' ? '' : ` · ${escapeHtml(group.describe)}`}</p><h2>${escapeHtml(group.title)} <em>› ${escapeHtml(group.label)}</em></h2></div>
      <p class="elsewhere" hidden>Not captured in this lane. Changed in: <span></span></p>
    </header>
    ${group.rows.map(lanePane).join('')}
  </section>`
}

function navMark(state: GroupState): string {
  if (state === 'same' || state === 'new') return ''
  return `<i class="mark ${state}" title="${state}"></i>`
}

/**
 * Lane-independent: one line per test under its spec, the spec folded until
 * it holds something worth opening or the reader opens it. A test shows a
 * mark only when one of its captures changed, failed or never settled, since
 * a list of what stayed the same is nothing anyone came to read.
 */
function navRail(groups: RowGroup[]): string {
  const specs = [...new Set(groups.map((group) => group.spec))]
  return specs
    .map((spec) => {
      const specGroups = groups.filter((group) => group.spec === spec)
      const describes = [...new Set(specGroups.map((group) => group.describe))]
      const tests = [...new Set(specGroups.map((group) => group.testKey))]
      let lastDescribe: string | undefined
      const items = tests
        .map((key) => {
          const captures = specGroups.filter((group) => group.testKey === key)
          const first = captures[0]
          const heading =
            describes.length > 1 && first.describe !== lastDescribe
              ? `<h4>${escapeHtml(first.describe === '' ? 'Outside a describe' : first.describe)}</h4>`
              : ''
          lastDescribe = first.describe
          const worst = captures
            .map(groupState)
            .sort((a, b) => RANK[a] - RANK[b])[0]
          const marks = captures
            .filter((group) => navMark(groupState(group)) !== '')
            .map(
              (group) =>
                `<a class="cap" href="#${group.id}" data-target="${group.id}" title="${escapeHtml(`${group.label}: ${groupState(group)}`)}">${navMark(groupState(group))}${escapeHtml(group.label)}</a>`,
            )
            .join('')
          return `${heading}<div class="test" data-state="${worst}" data-targets="${captures.map((group) => group.id).join(' ')}" data-text="${escapeHtml(`${spec} ${first.describe} ${first.title} ${captures.map((group) => group.label).join(' ')}`.toLowerCase())}"><a class="title" href="#${first.id}" data-target="${first.id}" title="${escapeHtml(`${first.describe === '' ? '' : `${first.describe} › `}${first.title}`)}">${escapeHtml(first.title)}</a>${marks === '' ? '' : `<span class="caps">${marks}</span>`}</div>`
        })
        .join('')
      const specState = specGroups.map(groupState).sort((a, b) => RANK[a] - RANK[b])[0]
      return `<details data-spec="${escapeHtml(spec)}" data-state="${specState}"><summary>${escapeHtml(spec)}${navMark(specState)}<b></b></summary>${items}</details>`
    })
    .join('')
}

const RANK: Record<GroupState, number> = { failed: 0, unsettled: 1, changed: 2, new: 3, same: 4 }

export function renderGallery(
  rows: GalleryRow[],
  manifest: RunManifest,
  baseline: BaselineFile | undefined,
  cost: RunCost,
): string {
  const running = manifest.status === 'running'
  const baselineBanner = baseline
    ? `<div class="baseline-banner">Baseline pinned at <code>${escapeHtml(baseline.ref)}</code> (${escapeHtml(baseline.sha.slice(0, 7))}). Plain runs diff against it. Clear with <code>npm run snapshots -- --clear-baseline</code>.</div>`
    : ''
  const groups = groupRows(rows)
  const body = groups.map(rowSection).join('')
  const changedCount = (predicate: (row: GalleryRow) => boolean): string => {
    const changed = rows.filter((row) => predicate(row) && row.changed).length
    return changed === 0 ? '' : `<b>${String(changed)}</b>`
  }
  const viewports = [...new Set(rows.map((row) => row.viewport))]
  const themes = [...new Set(rows.map((row) => row.theme))]
  const switchFor = (name: string, values: string[]): string =>
    values.length < 2
      ? ''
      : `<div class="switch" data-switch="${name}">${values
          .map(
            (value) =>
              `<button type="button" data-value="${escapeHtml(value)}">${escapeHtml(value)}${changedCount((row) => (name === 'viewport' ? row.viewport : row.theme) === value)}</button>`,
          )
          .join('')}</div>`
  const total = `<p class="total">
    <span class="figure"><b>${escapeHtml(formatDuration(cost.wallMs))}</b> <em>waited</em></span>
    <span class="figure"><b>${String(cost.captures)}</b> <em>captures this run</em></span>
  </p>`
  const filters = `<div class="switches">${switchFor('viewport', viewports)}${switchFor('theme', themes)}</div>
  <div class="filters">
    <label class="toggle" data-filter="run"><input type="checkbox" value="all" /> Show rows from earlier runs too</label>
    <label class="toggle" data-filter="changed"><input type="checkbox" value="changed" /> Only what changed${changedCount(() => true)}</label>
    <input type="search" id="search" placeholder="Filter by spec, test or label" />
  </div>`
  const { done, planned } = runProgress(manifest)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${running ? `<meta http-equiv="refresh" content="3" />` : ''}
  <title>${running ? `Capturing… ${String(done)}/${String(planned)}` : 'Catalyse snapshots'}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f5f7fb; }
    body { margin: 0; }
    aside { position: fixed; inset: 0 auto 0 0; width: 24rem; overflow: auto; border-right: 1px solid #d9e0ea; background: #fff; padding: 1rem; box-sizing: border-box; }
    aside h1 { margin: 0 0 .25rem; font-size: 1.1rem; }
    aside p { margin: 0 0 1rem; color: #64748b; font-size: .85rem; line-height: 1.45; }
    aside p.total { display: flex; gap: .9rem; margin-bottom: .9rem; padding: .55rem .65rem; border: 1px solid #d9e0ea; border-radius: .5rem; background: #fff; color: #334155; }
    aside p.total .figure { display: flex; flex-direction: column; gap: .1rem; }
    aside p.total b { font-size: 1.35rem; font-weight: 600; color: #172033; font-variant-numeric: tabular-nums; }
    aside p.total em { color: #94a3b8; font-size: .72rem; font-style: normal; line-height: 1.3; }
    aside h2 { margin: 1rem 0 .35rem; color: #334155; font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; }
    aside h3 { margin: .6rem 0 .2rem; color: #94a3b8; font-size: .68rem; letter-spacing: .08em; text-transform: uppercase; }
    aside details { margin: .2rem 0; }
    aside summary { display: flex; align-items: center; gap: .35rem; padding: .35rem .3rem; border-radius: .4rem; color: #334155; font-size: .78rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; cursor: pointer; list-style: none; }
    aside summary::-webkit-details-marker { display: none; }
    aside summary::before { content: "›"; display: inline-block; width: .8rem; color: #94a3b8; font-size: 1rem; line-height: 1; transition: transform .12s; }
    aside details[open] > summary::before { transform: rotate(90deg); }
    aside summary:hover { background: #f1f5f9; }
    aside summary b { margin-left: auto; color: #94a3b8; font-size: .68rem; font-weight: 600; letter-spacing: 0; text-transform: none; }
    aside h4 { margin: .4rem 0 .1rem 1.1rem; color: #64748b; font-size: .72rem; font-weight: 600; }
    aside .test { display: flex; flex-wrap: wrap; align-items: baseline; gap: .15rem .4rem; margin: 0 0 .05rem 1.1rem; padding: .25rem .4rem; border-radius: .4rem; }
    aside .test.active { background: #eff6ff; }
    aside a.title { color: #334155; text-decoration: none; font-size: .85rem; line-height: 1.3; }
    aside a.title:hover { color: #1a73e8; }
    aside .caps { display: inline-flex; flex-wrap: wrap; gap: .25rem; }
    aside a.cap { display: inline-flex; align-items: center; gap: .25rem; padding: 0 .4rem; border-radius: 999px; background: #eef2f7; color: #475569; text-decoration: none; font-size: .68rem; font-weight: 600; white-space: nowrap; }
    aside a.cap.active { outline: 2px solid #1a73e8; }
    i.mark { display: inline-block; width: .5rem; height: .5rem; border-radius: 999px; background: #dc2626; vertical-align: middle; }
    i.mark.unsettled { background: #d97706; }
    i.mark.failed { background: #dc2626; box-shadow: 0 0 0 2px #fecaca; }
    section h2 em { color: #64748b; font-style: normal; font-weight: 500; }
    aside .test[hidden], aside details[hidden], aside h4[hidden], section[hidden], .pane[hidden] { display: none; }
    .switches { display: flex; flex-direction: column; gap: .4rem; margin: 0 0 .75rem; padding-bottom: .75rem; border-bottom: 1px solid #e5eaf1; }
    .switch { display: flex; align-items: center; gap: .5rem; font-size: .78rem; color: #64748b; }
    .switch::before { content: attr(data-switch); width: 4.2rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; font-size: .68rem; }
    .switch button { flex: 1; padding: .3rem .5rem; border: 1px solid #cbd5e1; margin-left: -1px; background: #fff; color: #64748b; font: inherit; font-size: .8rem; font-weight: 600; cursor: pointer; text-transform: capitalize; }
    .switch button:first-of-type { border-radius: .4rem 0 0 .4rem; margin-left: 0; }
    .switch button:last-of-type { border-radius: 0 .4rem .4rem 0; }
    .switch button.on { background: #1e293b; border-color: #1e293b; color: #fff; }
    .switch button b { margin-left: .3rem; padding: 0 .3rem; border-radius: 999px; background: #fee2e2; color: #b91c1c; font-size: .7rem; }
    .pane-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .5rem 1rem 0; }
    .pane-head p { margin: 0; }
    .pane-head .badges { display: flex; align-items: center; gap: .5rem; flex: none; }
    .pane-head span { border-radius: 999px; padding: .2rem .55rem; background: #e2e8f0; color: #334155; font-size: .78rem; font-weight: 700; white-space: nowrap; }
    .pane-head .timing { background: #eef2f7; color: #64748b; font-variant-numeric: tabular-nums; }
    .pane[data-changed="true"] .pane-head span { background: #fff7ed; color: #c2410c; }
    .pane[data-changed="true"] .pane-head .timing { background: #eef2f7; color: #64748b; }
    p.elsewhere { margin: 0; color: #64748b; font-size: .8rem; font-weight: 400; text-transform: none; letter-spacing: 0; }
    p.elsewhere span { font-weight: 600; color: #c2410c; }
    .filters { display: flex; flex-direction: column; gap: .4rem; margin: 0 0 .75rem; }
    .toggle { display: flex; align-items: center; gap: .45rem; color: #334155; font-size: .82rem; cursor: pointer; }
    .toggle input { margin: 0; accent-color: #1a73e8; }
    .toggle b { padding: 0 .3rem; border-radius: 999px; background: #fee2e2; color: #b91c1c; font-size: .7rem; }
    #search { width: 100%; box-sizing: border-box; padding: .4rem .6rem; border: 1px solid #d9e0ea; border-radius: .45rem; font: inherit; font-size: .85rem; }
    main { max-width: 1720px; margin-left: 24rem; padding: 1.25rem; }
    section { scroll-margin-top: 1rem; margin: 0 0 1.25rem; border: 1px solid #d9e0ea; border-radius: .5rem; background: #fff; box-shadow: 0 1px 3px rgb(15 23 42 / .08); }
    section > header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .8rem 1rem; border-bottom: 1px solid #e5eaf1; }
    section h2, section p { margin: 0; }
    section h2 { font-size: 1.05rem; }
    section p { color: #64748b; font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
    section p code { text-transform: none; letter-spacing: 0; font-weight: 500; }
    .shots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; padding: 1rem; }
    figure { margin: 0; min-width: 0; }
    figure.diff figcaption, figure.failed figcaption { color: #b91c1c; }
    figure.failed img { border-color: #fca5a5; }
    p.failure { margin: 0; padding: .6rem 1rem; border-bottom: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; font-size: .82rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
    figcaption { margin: 0 0 .4rem; color: #475569; font-size: .85rem; font-weight: 700; }
    figcaption time { font-weight: 400; color: #94a3b8; font-size: .78rem; }
    img, .missing div { width: 100%; border: 1px solid #d9e0ea; border-radius: .35rem; background: #f8fafc; }
    img { display: block; height: auto; }
${LANES.map(
  (lane) => `    .pane[data-lane="${lane.id}"] img { max-width: ${String(lane.width)}px; }`,
).join('\n')}
    .missing div { display: grid; min-height: 12rem; place-items: center; color: #64748b; }
    .baseline-banner { margin: 0 0 1.25rem; padding: .6rem 1rem; border: 1px solid #fcd34d; border-radius: .5rem; background: #fffbeb; color: #92400e; font-size: .82rem; }
    .baseline-banner code { background: #fef3c7; padding: .1rem .3rem; border-radius: .25rem; }
    .run-banner { margin: 0 0 1.25rem; padding: .7rem 1rem; border: 1px solid #d9e0ea; border-radius: .5rem; background: #fff; color: #475569; font-size: .82rem; }
    .run-banner.running { border-color: #1a73e8; background: #eff6ff; color: #1e40af; }
    .run-banner p { margin: 0 0 .3rem; }
    .run-banner p:last-of-type { margin-bottom: 0; }
    .run-banner b { color: #172033; }
    .run-banner.running b { color: #1e3a8a; }
    .run-banner .bad { color: #b91c1c; }
    .run-banner .bar { margin-top: .55rem; height: .4rem; border-radius: 999px; background: #dbeafe; overflow: hidden; }
    .run-banner .bar i { display: block; height: 100%; background: #1a73e8; }
    .run { border-radius: 999px; padding: .05rem .35rem; background: #eef2f7; color: #64748b; font-weight: 600; font-size: .72rem; font-variant-numeric: tabular-nums; }
    .run.now { background: #dcfce7; color: #15803d; }
    .run.ref { background: #fef3c7; color: #92400e; }
    .mark { border-radius: 999px; padding: .05rem .4rem; font-size: .72rem; font-weight: 700; }
    section header .mark.carried, aside .mark.carried { background: #eef2f7; color: #94a3b8; }
    section header .mark.bad, aside .mark.bad { background: #fee2e2; color: #b91c1c; }
    .empty { padding: 3rem 1rem; color: #64748b; text-align: center; }
    @media (max-width: 900px) {
      aside { position: sticky; top: 0; z-index: 10; width: auto; max-height: 45dvh; border-right: 0; border-bottom: 1px solid #d9e0ea; }
      main { margin-left: 0; }
      .shots { grid-template-columns: 1fr !important; }
    }
  </style>
</head>
<body>
  <aside>
    <h1>Catalyse snapshots</h1>
    <p>Generated by <code>npm run snapshots</code>. Nothing here is tracked by git; this page compares the latest run with the one before it.</p>
    ${total}
    ${filters}
    ${navRail(groups)}
  </aside>
  <main>${runBanner(manifest, baseline, cost)}${baselineBanner}${mixedBaselineBanner(rows)}${mixedCurrentBanner(rows)}${body}<p class="empty" id="empty" hidden>Nothing matches these filters.</p></main>
  <script>
    const chosen = { run: "this", changed: "all", viewport: "", theme: "" };
    for (const key of Object.keys(chosen)) {
      const saved = localStorage.getItem("catalyse-snapshots-" + key);
      if (saved) chosen[key] = saved;
    }
    // A switch's first position is the default, and a remembered position
    // that this page has no lane for falls back to it.
    for (const sw of document.querySelectorAll(".switch")) {
      const values = [...sw.querySelectorAll("button")].map((button) => button.dataset.value);
      if (!values.includes(chosen[sw.dataset.switch])) chosen[sw.dataset.switch] = values[0];
    }
    const search = document.getElementById("search");
    search.value = localStorage.getItem("catalyse-snapshots-search") || "";
    const laneShown = (pane) =>
      (chosen.viewport === "" || pane.dataset.viewport === chosen.viewport) &&
      (chosen.theme === "" || pane.dataset.theme === chosen.theme);
    const sectionShown = (section) =>
      (chosen.run === "all" || section.dataset.run !== "other") &&
      (chosen.changed === "all" || section.dataset.state !== "same") &&
      (search.value === "" || section.dataset.text.includes(search.value.toLowerCase()));
    const laneName = (pane) => pane.dataset.viewport + " · " + pane.dataset.theme;
    const applyFilters = () => {
      let shown = 0;
      const visible = new Set();
      for (const section of document.querySelectorAll("main section")) {
        section.hidden = !sectionShown(section);
        if (section.hidden) continue;
        shown += 1;
        visible.add(section.id);
        // The chosen lane's pane shows; when this row has none, say where it does exist.
        let any = false;
        const changedElsewhere = [];
        for (const pane of section.querySelectorAll(".pane")) {
          pane.hidden = !laneShown(pane);
          if (!pane.hidden) any = true;
          else if (pane.dataset.changed === "true") changedElsewhere.push(laneName(pane));
        }
        const note = section.querySelector(".elsewhere");
        note.hidden = any;
        note.querySelector("span").textContent = changedElsewhere.length ? changedElsewhere.join(", ") : "no other lane";
      }
      document.getElementById("empty").hidden = shown > 0;
      for (const banner of document.querySelectorAll("[data-when]")) {
        banner.hidden = banner.dataset.when !== chosen.run;
      }
      for (const block of document.querySelectorAll("aside .test")) {
        block.hidden = !block.dataset.targets.split(" ").some((id) => visible.has(id));
      }
      for (const details of document.querySelectorAll("aside details")) {
        const tests = [...details.querySelectorAll(".test")];
        const showing = tests.filter((block) => !block.hidden);
        details.hidden = showing.length === 0;
        details.querySelector("summary b").textContent = showing.length + " / " + tests.length;
        for (const heading of details.querySelectorAll("h4")) {
          let sibling = heading.nextElementSibling;
          let any = false;
          while (sibling && sibling.tagName !== "H4") {
            if (!sibling.hidden) any = true;
            sibling = sibling.nextElementSibling;
          }
          heading.hidden = !any;
        }
      }
      for (const toggle of document.querySelectorAll(".toggle")) {
        const input = toggle.querySelector("input");
        input.checked = chosen[toggle.dataset.filter] === input.value;
      }
      for (const sw of document.querySelectorAll(".switch")) {
        for (const button of sw.querySelectorAll("button")) {
          button.classList.toggle("on", button.dataset.value === chosen[sw.dataset.switch]);
        }
      }
    };
    for (const sw of document.querySelectorAll(".switch")) {
      sw.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        chosen[sw.dataset.switch] = button.dataset.value;
        localStorage.setItem("catalyse-snapshots-" + sw.dataset.switch, button.dataset.value);
        applyFilters();
      });
    }
    const OFF = { run: "this", changed: "all" };
    for (const toggle of document.querySelectorAll(".toggle")) {
      const input = toggle.querySelector("input");
      input.addEventListener("change", () => {
        const key = toggle.dataset.filter;
        chosen[key] = input.checked ? input.value : OFF[key];
        localStorage.setItem("catalyse-snapshots-" + key, chosen[key]);
        applyFilters();
      });
    }
    search.addEventListener("input", () => {
      localStorage.setItem("catalyse-snapshots-search", search.value);
      applyFilters();
    });
    applyFilters();

    // Specs start folded. The one whose row is on screen unfolds as the page
    // scrolls, and folds again when the reader moves on, unless they opened
    // it themselves, which sticks until they close it.
    const pinned = new Set();
    for (const details of document.querySelectorAll("aside details")) {
      details.querySelector("summary").addEventListener("click", () => {
        // Runs before the toggle, so the state read here is the one being left.
        if (details.open) pinned.delete(details.dataset.spec);
        else pinned.add(details.dataset.spec);
      });
    }

    const blocks = [...document.querySelectorAll("aside .test")];
    const activate = (id) => {
      let current = null;
      for (const block of blocks) {
        const on = block.dataset.targets.split(" ").includes(id);
        block.classList.toggle("active", on);
        if (on) current = block.closest("details");
      }
      for (const details of document.querySelectorAll("aside details")) {
        details.open = details === current || pinned.has(details.dataset.spec);
      }
      if (current) current.querySelector(".test.active")?.scrollIntoView({ block: "nearest" });
      for (const cap of document.querySelectorAll("aside a.cap")) cap.classList.toggle("active", cap.dataset.target === id);
    };
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible && !visible.target.hidden) activate(visible.target.id);
    }, { rootMargin: "-10% 0px -70% 0px", threshold: [0, .25, .5, .75] });
    for (const section of document.querySelectorAll("main section")) observer.observe(section);
${
  running
    ? `    addEventListener("beforeunload", () => sessionStorage.setItem("catalyse-snapshots-scroll", String(scrollY)));
    const savedScroll = sessionStorage.getItem("catalyse-snapshots-scroll");
    if (savedScroll) scrollTo(0, Number(savedScroll));`
    : ''
}
  </script>
</body>
</html>
`
}
