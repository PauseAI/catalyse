/**
 * Compare before/after demo clips — extracts per-scene clips, computes frame diffs,
 * writes results.json, then serves the static compare-viewer.html app.
 *
 * Usage:
 *   npm run demo:compare -- volunteer-signup-approval-flow
 *   npm run demo:compare
 */
import { execSync } from 'child_process'
import http from 'http'
import path from 'path'
import fs from 'fs'
import * as volunteerSignupApprovalFlow from './flows/volunteer-signup-approval-flow'
import * as projectSetupTaskFlow from './flows/project-setup-task-flow'
import { snapshotDir, type DemoManifestEntry } from './snapshot'

const ALL_FLOWS = [volunteerSignupApprovalFlow.meta, projectSetupTaskFlow.meta]

function scratchDir(flowName: string): string {
  return path.join(process.cwd(), 'demo', '.scratch', flowName)
}

function afterManifestPath(flowName: string): string {
  return path.join(process.cwd(), 'demo', 'output', `${flowName}.manifest.json`)
}

function sanitizeKey(key: string): string {
  return key
    .slice(0, 60)
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
}

function meanLuma(imagePath: string): number {
  try {
    const out = execSync(
      `ffprobe -f lavfi -i "movie=${imagePath},signalstats" -show_entries frame_tags=lavfi.signalstats.YAVG -of default=nk=1 2>/dev/null`,
    )
      .toString()
      .trim()
    return parseFloat(out)
  } catch {
    return 0
  }
}

export type SceneResult = {
  key: string
  safeKey: string
  changed: boolean
  beforeDurationMs: number
  afterDurationMs: number
  hasBeforeVideo: boolean
  hasAfterVideo: boolean
  hasBeforeStart: boolean
  hasBeforeEnd: boolean
  hasAfterStart: boolean
  hasAfterEnd: boolean
}

export type CompareResults = {
  flowName: string
  generatedAt: string
  scenes: SceneResult[]
}

function compareFlow(flowName: string): string {
  const refDir = snapshotDir(flowName)
  const manifestPath = path.join(refDir, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    console.error(`No snapshot at ${refDir}. Run \`npm run demo:snapshot\` first.`)
    process.exit(1)
  }

  const beforeEntries: DemoManifestEntry[] = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  // Load after manifest for accurate after-side timestamps (falls back to before if not yet re-run)
  const afterManPath = afterManifestPath(flowName)
  const afterEntries: DemoManifestEntry[] = fs.existsSync(afterManPath)
    ? JSON.parse(fs.readFileSync(afterManPath, 'utf8'))
    : beforeEntries
  const afterByKey = new Map(afterEntries.map((e) => [e.key, e]))

  const scratch = scratchDir(flowName)
  const diffDir = path.join(refDir, 'diff')
  const afterFrameDir = path.join(diffDir, 'frames')
  const scenesBeforeDir = path.join(diffDir, 'scenes', 'before')
  const scenesAfterDir = path.join(diffDir, 'scenes', 'after')
  fs.mkdirSync(afterFrameDir, { recursive: true })
  fs.mkdirSync(scenesBeforeDir, { recursive: true })
  fs.mkdirSync(scenesAfterDir, { recursive: true })

  const scenes: SceneResult[] = []

  for (const beforeEntry of beforeEntries) {
    const safeKey = sanitizeKey(beforeEntry.key)
    const afterEntry = afterByKey.get(beforeEntry.key) ?? beforeEntry

    // Extract before scene clip
    const beforeClipPath = path.join(
      refDir,
      'clips',
      `clip-${beforeEntry.clipIndex.toString().padStart(2, '0')}.webm`,
    )
    const beforeScenePath = path.join(scenesBeforeDir, `${safeKey}.webm`)
    if (fs.existsSync(beforeClipPath)) {
      const ss = (beforeEntry.clipMs / 1000).toFixed(3)
      const t = Math.max(0.1, beforeEntry.durationMs / 1000).toFixed(3)
      execSync(
        `ffmpeg -y -ss ${ss} -t ${t} -i "${beforeClipPath}" -c copy "${beforeScenePath}" 2>/dev/null`,
      )
    }

    // Extract after scene clip using after manifest timestamps
    const afterClipPath = path.join(
      scratch,
      `clip-${afterEntry.clipIndex.toString().padStart(2, '0')}.webm`,
    )
    const afterScenePath = path.join(scenesAfterDir, `${safeKey}.webm`)
    if (fs.existsSync(afterClipPath)) {
      const ss = (afterEntry.clipMs / 1000).toFixed(3)
      const t = Math.max(0.1, afterEntry.durationMs / 1000).toFixed(3)
      execSync(
        `ffmpeg -y -ss ${ss} -t ${t} -i "${afterClipPath}" -c copy "${afterScenePath}" 2>/dev/null`,
      )
    }

    // Extract after start+end frames for pixel diff
    const afterStartSec = Math.max(0, (afterEntry.clipMs + 300) / 1000)
    const afterEndSec = Math.max(
      afterStartSec + 0.5,
      (afterEntry.clipMs + afterEntry.durationMs - 300) / 1000,
    )
    const afterStartImg = path.join(afterFrameDir, `${safeKey}-start.png`)
    const afterEndImg = path.join(afterFrameDir, `${safeKey}-end.png`)

    if (fs.existsSync(afterClipPath)) {
      execSync(
        `ffmpeg -y -ss ${afterStartSec.toFixed(3)} -i "${afterClipPath}" -vframes 1 "${afterStartImg}" 2>/dev/null`,
      )
      execSync(
        `ffmpeg -y -ss ${afterEndSec.toFixed(3)} -i "${afterClipPath}" -vframes 1 "${afterEndImg}" 2>/dev/null`,
      )
    }

    const beforeStartImg = path.join(refDir, 'frames', `${safeKey}-start.png`)
    const beforeEndImg = path.join(refDir, 'frames', `${safeKey}-end.png`)

    // Pixel diff to detect visual changes
    let changed = false
    for (const [b, a] of [
      [beforeStartImg, afterStartImg],
      [beforeEndImg, afterEndImg],
    ]) {
      if (!fs.existsSync(b) || !fs.existsSync(a)) {
        changed = true
        continue
      }
      const diffPath = path.join(diffDir, `diff-${path.basename(a)}`)
      execSync(
        `ffmpeg -y -i "${b}" -i "${a}" -filter_complex "[0:v]format=rgb24[x];[1:v]format=rgb24[y];[x][y]blend=all_mode=difference" "${diffPath}" 2>/dev/null`,
      )
      if (meanLuma(diffPath) > 1.0) changed = true
    }

    scenes.push({
      key: beforeEntry.key,
      safeKey,
      changed,
      beforeDurationMs: beforeEntry.durationMs,
      afterDurationMs: afterEntry.durationMs,
      hasBeforeVideo: fs.existsSync(beforeScenePath),
      hasAfterVideo: fs.existsSync(afterScenePath),
      hasBeforeStart: fs.existsSync(beforeStartImg),
      hasBeforeEnd: fs.existsSync(beforeEndImg),
      hasAfterStart: fs.existsSync(afterStartImg),
      hasAfterEnd: fs.existsSync(afterEndImg),
    })
  }

  const results: CompareResults = {
    flowName,
    generatedAt: new Date().toISOString(),
    scenes,
  }

  fs.writeFileSync(path.join(diffDir, 'results.json'), JSON.stringify(results, null, 2))

  const changedCount = scenes.filter((s) => s.changed).length
  console.log(`\n${changedCount}/${scenes.length} scenes flagged as changed.`)
  console.log(`Results: ${path.join(diffDir, 'results.json')}`)
  return refDir
}

const flowArg = process.argv[2]
const flows = flowArg ? ALL_FLOWS.filter((f) => f.name === flowArg) : ALL_FLOWS
if (flowArg && !flows.length) {
  console.error(`Unknown flow: "${flowArg}". Available: ${ALL_FLOWS.map((f) => f.name).join(', ')}`)
  process.exit(1)
}

const refDirs: string[] = []
for (const flow of flows) refDirs.push(compareFlow(flow.name))

// Serve
const serveRefDir = refDirs[refDirs.length - 1]
const serveDiffDir = path.join(serveRefDir, 'diff')
const viewerPath = path.join(process.cwd(), 'demo', 'compare-viewer.html')
const PORT = 7331

const server = http.createServer((req, res) => {
  const url = req.url ?? '/'

  // Per-scene video clips
  const beforeScene = url.match(/^\/scene\/before\/([^/]+)$/)
  const afterScene = url.match(/^\/scene\/after\/([^/]+)$/)
  if (beforeScene) {
    const p = path.join(serveDiffDir, 'scenes', 'before', `${beforeScene[1]}.webm`)
    if (!fs.existsSync(p)) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'video/webm' })
    fs.createReadStream(p).pipe(res)
    return
  }
  if (afterScene) {
    const p = path.join(serveDiffDir, 'scenes', 'after', `${afterScene[1]}.webm`)
    if (!fs.existsSync(p)) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'video/webm' })
    fs.createReadStream(p).pipe(res)
    return
  }

  // Frame images — before from snapshot/frames, after from diff/frames
  const beforeFrame = url.match(/^\/frame\/before\/([^/]+)$/)
  const afterFrame = url.match(/^\/frame\/after\/([^/]+)$/)
  if (beforeFrame) {
    const p = path.join(serveRefDir, 'frames', beforeFrame[1])
    if (!fs.existsSync(p)) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'image/png' })
    fs.createReadStream(p).pipe(res)
    return
  }
  if (afterFrame) {
    const p = path.join(serveDiffDir, 'frames', afterFrame[1])
    if (!fs.existsSync(p)) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'image/png' })
    fs.createReadStream(p).pipe(res)
    return
  }

  // results.json from diffDir
  if (url === '/results.json') {
    const p = path.join(serveDiffDir, 'results.json')
    if (!fs.existsSync(p)) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    fs.createReadStream(p).pipe(res)
    return
  }

  // Root → serve the static viewer from repo (reads fresh on each request)
  if (url === '/' || url === '/index.html') {
    if (!fs.existsSync(viewerPath)) {
      res.writeHead(404)
      res.end('compare-viewer.html not found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    fs.createReadStream(viewerPath).pipe(res)
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`
  console.log(`\nServing at ${url}`)
  execSync(`open "${url}"`)
  console.log(
    'Ctrl-C to stop.\nEdit demo/compare-viewer.html and refresh to update the viewer without re-running compare.',
  )
})
