/** Build the app if anything it depends on changed; the e2e setup and the snapshot command both go through this. */
import { buildNext } from './next-build'

buildNext().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  },
)
