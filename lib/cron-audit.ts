import { prisma } from '@/lib/prisma'

const SUMMARY_MAX_LENGTH = 2000

function summarize(result: unknown): string {
  try {
    return JSON.stringify(result)?.slice(0, SUMMARY_MAX_LENGTH) ?? String(result)
  } catch {
    return String(result).slice(0, SUMMARY_MAX_LENGTH)
  }
}

export type CronTriggerSource = 'cron' | 'admin'

/** Runs `fn` for the already-started audit row `runId`, recording how it ended. */
export async function finishCronRun<T>(runId: number, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn()
    await prisma.cronJobRun.update({
      where: { id: runId },
      data: { finishedAt: new Date(), status: 'success', summary: summarize(result) },
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.cronJobRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        status: 'error',
        summary: message.slice(0, SUMMARY_MAX_LENGTH),
      },
    })
    throw err
  }
}

export async function recordCronRun<T>(
  jobName: string,
  fn: () => Promise<T>,
  triggeredBy: CronTriggerSource = 'cron',
): Promise<T> {
  const run = await prisma.cronJobRun.create({
    data: { jobName, status: 'running', triggeredBy },
  })
  return finishCronRun(run.id, fn)
}
