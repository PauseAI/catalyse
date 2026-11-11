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

export async function recordCronRun<T>(
  jobName: string,
  fn: () => Promise<T>,
  triggeredBy: CronTriggerSource = 'cron',
): Promise<T> {
  const run = await prisma.cronJobRun.create({
    data: { jobName, status: 'running', triggeredBy, startedAt: new Date() },
  })

  try {
    const result = await fn()
    await prisma.cronJobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: 'success', summary: summarize(result) },
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.cronJobRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: 'error',
        summary: message.slice(0, SUMMARY_MAX_LENGTH),
      },
    })
    throw err
  }
}
