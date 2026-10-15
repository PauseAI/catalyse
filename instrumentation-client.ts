import { z } from 'zod'

// Zod probes whether it may compile validators with `new Function`; the CSP (next.config.ts)
// forbids that, so the probe only files a violation report. Skip it and use the interpreter.
z.config({ jitless: true })
