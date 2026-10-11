import { defineConfig, devices, type Project } from '@playwright/test'
import { WORKER_COUNT } from './e2e/config'
import { LANES, SNAPSHOTS_ENABLED, snapshotBlock } from './e2e/snapshots/config'

/**
 * A snapshot run captures every test once per lane. Each lane is a Playwright
 * project named after it, with the viewport it shoots at; the theme is applied
 * by the fixtures. `npm run snapshots` runs each lane as a process of its own
 * on its own block of servers, so a worker pool never mixes lanes, and a
 * worker takes whole spec files so a file's tests keep their order and their
 * database history.
 */
const laneProjects: Project[] = LANES.map((lane) => ({
  name: lane.id,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: lane.width, height: lane.height },
    deviceScaleFactor: lane.deviceScaleFactor,
    isMobile: lane.isMobile,
    hasTouch: lane.isMobile,
    colorScheme: lane.theme,
  },
}))

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: !SNAPSHOTS_ENABLED,
  workers: SNAPSHOTS_ENABLED ? snapshotBlock().count : WORKER_COUNT,
  reporter: SNAPSHOTS_ENABLED
    ? [['line'], ['./e2e/snapshots/reporter.ts']]
    : process.env.CI
      ? 'github'
      : 'line',
  retries: 0,
  // A capture waits for the page to hold still before every shot.
  timeout: SNAPSHOTS_ENABLED ? 120_000 : 60_000,
  globalSetup: require.resolve('./e2e/global-setup'),
  globalTeardown: require.resolve('./e2e/global-teardown'),
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: { slowMo: parseInt(process.env.SLOW_MO ?? '0', 10) },
  },
  projects: SNAPSHOTS_ENABLED
    ? laneProjects
    : [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
