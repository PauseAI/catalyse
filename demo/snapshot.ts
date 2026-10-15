/**
 * Save reference clips + start/end frames from the latest demo run.
 * Run immediately after `npm run demo -- <flow>` before re-running.
 *
 * Usage:
 *   npm run demo:snapshot -- volunteer-signup-approval-flow
 *   npm run demo:snapshot
 */
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import * as volunteerSignupApprovalFlow from './flows/volunteer-signup-approval-flow'
import * as projectSetupTaskFlow from './flows/project-setup-task-flow'

const ALL_FLOWS = [volunteerSignupApprovalFlow.meta, projectSetupTaskFlow.meta]

export function snapshotDir(flowName: string): string {
  return path.join(process.cwd(), 'demo', 'snapshots', flowName)
}

function scratchDir(flowName: string): string {
  return path.join(process.cwd(), 'demo', '.scratch', flowName)
}

function demoManifestPath(flowName: string): string {
  return path.join(process.cwd(), 'demo', 'output', `${flowName}.manifest.json`)
}

export type DemoManifestEntry = {
  key: string
  clipIndex: number
  clipMs: number
  durationMs: number
}

export function extractSnapshot(flowName: string): void {
  const manifestPath = demoManifestPath(flowName)
  if (!fs.existsSync(manifestPath)) {
    console.error(`No manifest at ${manifestPath}. Run the demo first.`)
    process.exit(1)
  }

  const entries: DemoManifestEntry[] = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const scratch = scratchDir(flowName)
  const out = snapshotDir(flowName)

  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(path.join(out, 'clips'), { recursive: true })
  fs.mkdirSync(path.join(out, 'frames'), { recursive: true })

  // Copy clips
  const clipIndices = [...new Set(entries.map((e) => e.clipIndex))].sort((a, b) => a - b)
  for (const i of clipIndices) {
    const name = `clip-${i.toString().padStart(2, '0')}.webm`
    const src = path.join(scratch, name)
    if (!fs.existsSync(src)) {
      console.warn(`Missing ${src}`)
      continue
    }
    fs.copyFileSync(src, path.join(out, 'clips', name))
    console.log(`  Copied ${name}`)
  }

  // Extract start + end frame per narration
  for (const entry of entries) {
    const clipPath = path.join(scratch, `clip-${entry.clipIndex.toString().padStart(2, '0')}.webm`)
    if (!fs.existsSync(clipPath)) continue
    const key = entry.key
      .slice(0, 60)
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
    const startSec = Math.max(0, (entry.clipMs + 300) / 1000)
    const duration = entry.durationMs > 0 ? entry.durationMs : 3000
    const endSec = Math.max(startSec + 0.5, (entry.clipMs + duration - 300) / 1000)
    execSync(
      `ffmpeg -y -ss ${startSec.toFixed(3)} -i "${clipPath}" -vframes 1 "${path.join(out, 'frames', `${key}-start.png`)}" 2>/dev/null`,
    )
    execSync(
      `ffmpeg -y -ss ${endSec.toFixed(3)} -i "${clipPath}" -vframes 1 "${path.join(out, 'frames', `${key}-end.png`)}" 2>/dev/null`,
    )
  }

  // Copy manifest
  fs.copyFileSync(manifestPath, path.join(out, 'manifest.json'))
  console.log(`\nSnapshot saved to ${out}`)
}

// Guards the CLI behaviour below so other files can import extractSnapshot without
// triggering it as a side effect of the import — ESM runs a module's top level once,
// whether it was loaded directly or pulled in by something else.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flowArg = process.argv[2]
  const flows = flowArg ? ALL_FLOWS.filter((f) => f.name === flowArg) : ALL_FLOWS
  if (flowArg && !flows.length) {
    console.error(
      `Unknown flow: "${flowArg}". Available: ${ALL_FLOWS.map((f) => f.name).join(', ')}`,
    )
    process.exit(1)
  }
  for (const flow of flows) extractSnapshot(flow.name)
}
