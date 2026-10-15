import { FullConfig } from '@playwright/test'
import { execSync } from 'child_process'
import fs from 'fs'
import { IS_LOCAL, BASE_PORT, pidsFile } from './config'
import { SNAPSHOTS_ENABLED, snapshotBlock } from './snapshots/config'

// Only the listener: a client socket to the port (Playwright itself, holding a keep-alive
// connection) would otherwise be killed too.
function killServerOnPort(port: number): void {
  try {
    execSync(`lsof -tiTCP:${port} -sTCP:LISTEN | xargs kill -TERM 2>/dev/null || true`, {
      shell: '/bin/sh',
    })
  } catch {
    // nothing listening
  }
}

async function globalTeardown(config: FullConfig): Promise<void> {
  if (!IS_LOCAL) return

  const block = SNAPSHOTS_ENABLED ? snapshotBlock() : { first: 0, count: config.workers }
  const file = pidsFile(block.first)
  if (fs.existsSync(file)) {
    const pids: Record<string, number> = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const pid of Object.values(pids)) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* already exited */
      }
    }
    fs.unlinkSync(file)
  }

  for (let i = block.first; i < block.first + block.count; i++) {
    killServerOnPort(BASE_PORT + i)
  }
}

export default globalTeardown
