import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { logger } from '../lib/logger'

const PROJECT_ROOT = path.resolve(__dirname, '..')
const NEXT_BINARY = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'next')

// Build inputs .tsbuildinfo never lists: it tracks only the TS/TSX program
// files. CSS (turbopack inlines styles) and non-TS config files must be
// tracked explicitly.
const CONFIG_FILES = [
  'next.config.ts',
  'postcss.config.mjs',
  'prisma.config.ts',
  'prisma/schema.prisma',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
]

function walkDir(dir: string, ext?: string): string[] {
  const files: string[] = []
  if (!fs.existsSync(dir)) return files
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (!ext || entry.name.endsWith(ext)) files.push(full)
    }
  }
  walk(dir)
  return files
}

function getSourceFiles(): string[] {
  const tsBuildInfo = path.join(PROJECT_ROOT, '.next', 'cache', '.tsbuildinfo')
  if (fs.existsSync(tsBuildInfo)) {
    const { fileNames } = JSON.parse(fs.readFileSync(tsBuildInfo, 'utf8')) as {
      fileNames: string[]
    }
    const base = path.dirname(tsBuildInfo)
    const tsFiles = fileNames
      .filter((f) => !f.includes('node_modules'))
      .map((f) => path.resolve(base, f))
    return [
      ...tsFiles,
      ...CONFIG_FILES.map((f) => path.join(PROJECT_ROOT, f)),
      ...walkDir(path.join(PROJECT_ROOT, 'app'), '.css'),
      ...walkDir(path.join(PROJECT_ROOT, 'public')),
    ]
  }

  // fallback: full source tree scan (pre-first-build)
  const SKIP_DIRS = new Set(['.next', 'node_modules', '.git'])
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name))
      } else {
        files.push(path.join(dir, entry.name))
      }
    }
  }
  walk(PROJECT_ROOT)
  return files
}

export function isBuildFresh(): boolean {
  const buildId = path.join(PROJECT_ROOT, '.next', 'BUILD_ID')
  if (!fs.existsSync(buildId)) return false

  const buildMtime = fs.statSync(buildId).mtimeMs
  return !getSourceFiles().some((f) => fs.existsSync(f) && fs.statSync(f).mtimeMs > buildMtime)
}

export async function buildNext(): Promise<void> {
  if (isBuildFresh()) {
    logger.info('[build] Fresh — skipping next build')
    return
  }
  logger.info('[build] Building...')
  await new Promise<void>((resolve, reject) => {
    const build = spawn(NEXT_BINARY, ['build'], { cwd: PROJECT_ROOT, stdio: 'pipe' })
    const chunks: Buffer[] = []
    build.stdout.on('data', (d) => chunks.push(d))
    build.stderr.on('data', (d) => chunks.push(d))
    build.on('close', (code) => {
      if (code === 0) {
        logger.info('[build] Success')
        return resolve()
      }
      logger.error(
        '[build] FAILED — next build runs before tests start. Tests did not run. Build output:',
      )
      process.stdout.write(Buffer.concat(chunks))
      reject(new Error(`next build failed (exit ${code})`))
    })
  })
}
