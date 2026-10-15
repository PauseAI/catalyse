/**
 * `npm run snapshots`: the command in front of the visual snapshot run.
 *
 * The run itself is the Playwright E2E suite with `SNAPSHOTS=1`, which turns
 * on the lanes, the capture fixtures and the reporter under `e2e/snapshots/`.
 * This script adds the two things Playwright cannot do for itself: pin a git
 * ref as the baseline, and clear that pin.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  BASELINE,
  GALLERY,
  historyFile,
  LATEST,
  POOL,
  PREVIOUS,
  RUNS,
  sidecarFile,
  type CaptureMeta,
} from '../e2e/snapshots/config'
import { LANES, snapshotServerCount } from '../e2e/snapshots/config'
import { renderGallery } from '../e2e/snapshots/gallery'
import { buildNext } from './next-build'
import {
  appendHistory,
  clearBaseline,
  pngSha,
  readBaseline,
  writeBaseline,
} from '../e2e/snapshots/png'
import { galleryRows } from '../e2e/snapshots/rows'
import { listRuns, mergeLatestRuns } from '../e2e/snapshots/runs'

const ROOT = path.resolve(__dirname, '..')

const USAGE = `npm run snapshots [-- <flags> <playwright arguments>]

Runs the E2E suite once per lane with every test photographed, writes
snapshots/index.html, and diffs each picture against the run before it.

  --against=<ref>    Capture <ref> in a temporary worktree and pin it as the
                     baseline every later plain run diffs against.
  --clear-baseline   Drop that pin and go back to diffing the run before.
  --render           Rebuild snapshots/index.html from the newest complete run
                     of each lane on disk, without capturing anything.
  --help             This.

Anything else is passed to Playwright, so a run can be narrowed the usual way:

  npm run snapshots -- --project=desktop-light
  npm run snapshots -- e2e/tests/11-dashboard.spec.ts
  npm run snapshots -- --grep "marks all notifications as read"   # one test, by its title

A narrowed run regenerates only the matching pictures; the gallery still
shows every other row from the last full run, marked as carried.`

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): number {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

function output(command: string, args: string[], cwd = ROOT): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
  return result.stdout.trim()
}

const PLAYWRIGHT = path.join(ROOT, 'node_modules', '.bin', 'playwright')

/** The lanes an argument list names with `--project`, or every lane. */
function lanesFrom(args: string[]): string[] {
  const named = args
    .flatMap((arg, i) =>
      arg === '--project' ? [args[i + 1]] : arg.startsWith('--project=') ? [arg.slice(10)] : [],
    )
    .filter((id): id is string => id !== undefined)
  return named.length > 0 ? named : LANES.map((lane) => lane.id)
}

/**
 * Run the suite once per lane, every lane at once, each as a Playwright
 * process of its own on a block of servers shared out from the machine's
 * count. A process's worker pool then never mixes lanes, so each of a lane's
 * tests lands on a server only that lane has touched.
 */
async function playwright(args: string[], cwd = ROOT): Promise<number> {
  const lanes = lanesFrom(args)
  const rest = args.filter((arg, i) => !arg.startsWith('--project') && args[i - 1] !== '--project')
  const perLane = Math.max(1, Math.floor(snapshotServerCount() / lanes.length))
  // One build for every lane, done here so four processes never build at
  // once. A worktree builds with its own copy of the script, in its own tree.
  const prebuilt = process.env.E2E_DEV !== '1'
  if (prebuilt) {
    if (cwd === ROOT) await buildNext()
    else if (
      run(path.join(cwd, 'node_modules', '.bin', 'tsx'), ['scripts/build-once.ts'], { cwd }) !== 0
    ) {
      throw new Error('The worktree build failed')
    }
  }
  const children = lanes.map(
    (lane, i) =>
      new Promise<number>((resolve, reject) => {
        const child = spawn(PLAYWRIGHT, ['test', `--project=${lane}`, ...rest], {
          cwd,
          env: {
            ...process.env,
            SNAPSHOTS: '1',
            SNAPSHOT_SERVER_FIRST: String(i * perLane),
            SNAPSHOT_SERVER_COUNT: String(perLane),
            ...(prebuilt ? { SNAPSHOT_PREBUILT: '1' } : {}),
          },
          stdio: 'inherit',
        })
        child.on('error', reject)
        child.on('exit', (code) => resolve(code ?? 1))
      }),
  )
  const codes = await Promise.all(children)
  return codes.find((code) => code !== 0) ?? 0
}

/**
 * Capture `ref` in a git worktree, copy what it captured into `previous/`,
 * and pin it so plain runs diff against it. The working tree and `current/`
 * here are never touched.
 *
 * The worktree lives under the repo's own ignored scratch directory rather
 * than the system temp: the build refuses a node_modules that points outside
 * its root, so the worktree gets a hard-linked copy instead, and hard links
 * need one filesystem.
 */
async function captureAgainst(ref: string, args: string[]): Promise<number> {
  await mkdir(path.join(ROOT, 'tmp'), { recursive: true })
  const worktree = await mkdtemp(path.join(ROOT, 'tmp', 'snapshots-against-'))
  console.log(`Capturing ${ref} in a worktree at ${worktree}`)
  try {
    run('git', ['worktree', 'add', '--detach', worktree, ref])
    const linked = run('cp', [
      '-al',
      path.join(ROOT, 'node_modules'),
      path.join(worktree, 'node_modules'),
    ])
    if (linked !== 0) throw new Error('Could not link node_modules into the worktree')
    // The worktree shares dependencies but not the environment; the suite reads both.
    for (const envFile of ['.env', '.env.local']) {
      if (existsSync(path.join(ROOT, envFile))) {
        await copyFile(path.join(ROOT, envFile), path.join(worktree, envFile))
      }
    }
    const status = await playwright(args, worktree)
    if (status !== 0)
      console.log(`The ${ref} run exited ${String(status)}; pinning what it captured.`)
    const worktreeCurrent = path.join(worktree, 'snapshots', 'current')
    if (!existsSync(worktreeCurrent)) throw new Error(`The ${ref} run captured nothing.`)
    await mkdir(PREVIOUS, { recursive: true })
    await mkdir(POOL, { recursive: true })
    const pins: Record<string, string> = {}
    for (const entry of await readdir(worktreeCurrent)) {
      if (!entry.endsWith('.png')) continue
      const source = path.join(worktreeCurrent, entry)
      const buffer = await readFile(source)
      const sha = pngSha(buffer)
      if (!existsSync(path.join(POOL, `${sha}.png`)))
        await copyFile(source, path.join(POOL, `${sha}.png`))
      await copyFile(source, path.join(PREVIOUS, entry))
      const sidecar = path.join(worktreeCurrent, sidecarFile(entry))
      if (existsSync(sidecar)) {
        // Inside the worktree this was a plain run of its own; only here does
        // it become the ref's picture.
        const meta = JSON.parse(await readFile(sidecar, 'utf8')) as CaptureMeta
        meta.ref = ref
        await writeFile(path.join(PREVIOUS, sidecarFile(entry)), JSON.stringify(meta, null, 2))
      }
      pins[entry] = sha
      await appendHistory(entry, sha, ref, historyFile(entry.split('--')[0]))
    }
    if (Object.keys(pins).length === 0) throw new Error(`The ${ref} run captured nothing.`)
    const sha = output('git', ['rev-parse', ref])
    await writeBaseline({ ref, sha, pinnedAt: new Date().toISOString(), pins }, BASELINE)
    console.log(
      `Baseline pinned at ${ref} (${sha.slice(0, 7)}), ${String(Object.keys(pins).length)} pictures. Plain runs now diff against it; clear with --clear-baseline.`,
    )
    return 0
  } finally {
    run('git', ['worktree', 'remove', '--force', worktree])
    await rm(worktree, { recursive: true, force: true })
  }
}

/**
 * The gallery from what is on disk: the newest complete run of each lane,
 * merged, so a page can be rebuilt without capturing anything.
 */
async function render(): Promise<number> {
  const manifest = mergeLatestRuns(await listRuns(RUNS))
  if (!manifest) {
    console.error('No complete run to render.')
    return 1
  }
  const captures = Object.values(manifest.captures)
  const cost = {
    captures: captures.length,
    ms: captures.reduce((sum, capture) => sum + (capture.durationMs ?? 0), 0),
    wallMs: 0,
  }
  const rows = await galleryRows(manifest)
  await writeFile(GALLERY, renderGallery(rows, manifest, await readBaseline(BASELINE), cost))
  await writeFile(LATEST, JSON.stringify(manifest, null, 2))
  console.log(`Gallery: ${GALLERY} (${manifest.lanes.join(', ')})`)
  return 0
}

async function main(argv: string[]): Promise<number> {
  const passthrough: string[] = []
  let against: string | undefined
  let clear = false
  let rerender = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE)
      return 0
    }
    if (arg === '--clear-baseline') {
      clear = true
    } else if (arg === '--render') {
      rerender = true
    } else if (arg.startsWith('--against=')) {
      against = arg.slice('--against='.length)
    } else if (arg === '--against') {
      against = argv[i + 1]
      i += 1
    } else {
      passthrough.push(arg)
    }
  }
  if (clear) {
    console.log(
      (await clearBaseline(BASELINE))
        ? 'Baseline cleared. Plain runs diff against the run before them again.'
        : 'No baseline was pinned.',
    )
    return 0
  }
  if (rerender) return render()
  if (against !== undefined) return captureAgainst(against, passthrough)
  const status = await playwright(passthrough)
  await render()
  return status
}

main(process.argv.slice(2)).then(
  (status) => process.exit(status),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  },
)
