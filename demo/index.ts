import { chromium, Browser } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { buildForDemo, startDemoServer, stopDemoServer } from './server'
import { DemoEngine } from './engine'
import { extractSnapshot } from './snapshot'
import * as volunteerSignupApprovalFlow from './flows/volunteer-signup-approval-flow'
import * as projectSetupTaskFlow from './flows/project-setup-task-flow'

type FlowModule = {
  meta: { name: string; title: string }
  run: (engine: DemoEngine, browser: Browser) => Promise<void>
}

const ALL_FLOWS: FlowModule[] = [volunteerSignupApprovalFlow, projectSetupTaskFlow]

function deduplicateNarrationTexts(texts: string[]): string[] {
  const counts = new Map<string, number>()
  for (const t of texts) counts.set(t, (counts.get(t) ?? 0) + 1)
  const seen = new Map<string, number>()
  return texts.map((t) => {
    if (counts.get(t)! === 1) return t
    const n = (seen.get(t) ?? 0) + 1
    seen.set(t, n)
    return `${t}-${n}`
  })
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const fast = rawArgs.includes('--fast')
  const flowArg = rawArgs.find((a) => !a.startsWith('--'))
  let flowsToRun: FlowModule[]

  if (fast && !flowArg) {
    console.error(
      '--fast requires a flow name, e.g. `npm run demo:fast volunteer-signup-approval-flow`.',
    )
    process.exit(1)
  }

  if (flowArg) {
    const found = ALL_FLOWS.find((f) => f.meta.name === flowArg)
    if (!found) {
      console.error(
        `Unknown flow: "${flowArg}". Available: ${ALL_FLOWS.map((f) => f.meta.name).join(', ')}`,
      )
      process.exit(1)
    }
    flowsToRun = [found]
  } else {
    process.env.DEMO_HEADLESS = 'true'
    flowsToRun = ALL_FLOWS
  }

  console.log('Building for demo...')
  await buildForDemo()

  for (const flow of flowsToRun) {
    console.log(`\n=== Running flow: ${flow.meta.name}${fast ? ' (fast)' : ''} ===`)

    const scratchDir = path.join(process.cwd(), 'demo', '.scratch', flow.meta.name)

    fs.rmSync(scratchDir, { recursive: true, force: true })
    fs.mkdirSync(scratchDir, { recursive: true })

    let engine: DemoEngine
    if (fast) {
      // Fast harness: real clicks/typing/navigation against a real browser, but no TTS
      // generation, no character-by-character typing delay, and no video/audio capture —
      // for quickly debugging flow logic rather than producing the narrated recording.
      engine = new DemoEngine({ fast: true, scratchDir })
      process.stdout.write('  Waiting for server...')
      await startDemoServer(flow.meta.name)
      console.log(' ready.')
    } else {
      // Detect all narration texts without TTS or recording
      const detectEngine = new DemoEngine({ detectMode: true, scratchDir })
      await flow.run(detectEngine, null as unknown as Browser)
      const rawTexts = detectEngine.collectNarration()
      const narrationKeys = deduplicateNarrationTexts(rawTexts)
      console.log(`  Found ${rawTexts.length} narration clips.`)

      // Pre-generate TTS and start server concurrently — whichever takes longer wins
      engine = new DemoEngine({ scratchDir })
      engine.setNarrationKeys(narrationKeys)
      process.stdout.write('  Waiting for server and pre-generating narration...')
      await Promise.all([engine.pregenerateNarration(rawTexts), startDemoServer(flow.meta.name)])
      console.log(' ready.')
    }

    try {
      const browser = await chromium.launch({ headless: !!process.env.DEMO_HEADLESS })
      try {
        await flow.run(engine, browser)
      } finally {
        await browser.close()
      }

      if (fast) continue

      const outputDir = path.join(process.cwd(), 'demo', 'output')
      fs.mkdirSync(outputDir, { recursive: true })
      await engine.compile(path.join(outputDir, `${flow.meta.name}.webm`))
      const snapManifest = path.join(
        process.cwd(),
        'demo',
        'snapshots',
        flow.meta.name,
        'manifest.json',
      )
      if (!fs.existsSync(snapManifest)) {
        console.log('  No snapshot found — saving initial snapshot...')
        extractSnapshot(flow.meta.name)
      } else {
        console.log(
          '  Snapshot exists — run `npm run demo:snapshot` to promote this run as new reference.',
        )
      }
    } finally {
      stopDemoServer()
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
