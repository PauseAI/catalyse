/** Build the app if anything it depends on changed; the e2e setup and the snapshot command both go through this. */
import { logger } from '../lib/logger'
import { buildNext } from './next-build'

buildNext().then(
  () => process.exit(0),
  (error: unknown) => {
    logger.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  },
)
