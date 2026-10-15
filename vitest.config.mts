import { defineConfig } from 'vitest/config'
import { availableParallelism } from 'node:os'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The unit tier, run with `npm run test:unit`. It covers everything the app is built from —
 * pure logic, oRPC routers against a real Postgres database, and React components/pages
 * rendered in jsdom — and CI fails unless every line and statement of the covered tree is
 * executed. Anything that needs a real browser (layout, navigation between pages, a full
 * production build) still belongs in the Playwright suite under `e2e/`.
 *
 * Two projects share one config: `.test.ts` files run in plain node, `.test.tsx` files get a
 * jsdom window. The shared harness lives in `test/`; each file there explains its part.
 */
// Same files and precedence as lib/db-url, so `VITEST_MAX_WORKERS` can be set in .env.local.
for (const file of ['.env', '.env.local']) if (existsSync(file)) process.loadEnvFile(file)

const alias = { '@': fileURLToPath(new URL('.', import.meta.url)) }
// Playwright owns `e2e/**/*.spec.ts`; vitest only ever collects `*.test.ts(x)`.
const exclude = ['node_modules/**', 'e2e/**', '.next/**', 'generated/**', 'tmp/**', '.claude/**']

// Every worker holds a jsdom window and a private copy of the database per test file. A dev
// machine also runs the browser, editor and Docker, so a worker per core starves the page
// tests into timeouts; use half the cores. CI has the machine to itself and takes vitest's
// default. `VITEST_MAX_WORKERS` (settable in .env.local) overrides either.
const maxWorkers =
  Number(process.env.VITEST_MAX_WORKERS) ||
  (process.env.CI ? undefined : Math.max(1, Math.floor(availableParallelism() / 2)))

// Locally a run prints only failing tests and a summary: a passing run should be one screen,
// and a test's console output is shown only if it fails. CI keeps the full log and the
// per-file coverage table. Pass `--reporter=default` for the tick-by-tick view.
const quiet = !process.env.CI
// The JSON results let `npm run test:unit` tell a failing test from a coverage shortfall.
const RESULTS_FILE = 'tmp/unit-results.json'

export default defineConfig({
  resolve: { alias },
  test: {
    maxWorkers,
    reporters: [
      quiet ? 'minimal' : 'default',
      ['json', { outputFile: RESULTS_FILE }],
      ...(process.env.GITHUB_ACTIONS === 'true' ? ['github-actions'] : []),
    ],
    globalSetup: ['./test/global-setup.ts'],
    // Transformed modules are kept under node_modules/.vitest-cache, so a run only pays to
    // transform what changed since the last one.
    fsModuleCache: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          include: ['**/*.test.ts'],
          exclude,
          environment: 'node',
          setupFiles: ['./test/setup-db.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'dom',
          include: ['**/*.test.tsx'],
          exclude,
          environment: 'jsdom',
          setupFiles: ['./test/setup-db.ts', './test/setup-dom.ts'],
          // Page tests walk whole flows through real RPC calls; on a busy CI runner that
          // takes a few times longer than locally.
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['app/**', 'components/**', 'lib/**', 'server/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      // `npm run test:unit` lists the uncovered lines when only coverage fails.
      reporter: [quiet ? 'text-summary' : 'text', 'html', 'lcov', 'json', 'json-summary'],
      // CI reads the summary even from a failed run, to show what was missed alongside the failure.
      reportOnFailure: true,
      reportsDirectory: './coverage',
      thresholds: { lines: 100, statements: 100 },
    },
  },
})
