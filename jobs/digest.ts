import { prisma } from '@/lib/prisma'
import { sendDigestEmail, isEmailConfigured } from '@/lib/email'
import { WorkItemType } from '@/generated/prisma/enums'

const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS)
}

export async function runDigestJob(): Promise<Record<string, unknown>> {
  if (!isEmailConfigured()) {
    console.log('[CRON DIGEST] Email not configured, skipping')
    return { skipped: true, reason: 'email not configured' }
  }

  const lastDigest = await prisma.digestRun.findFirst({
    where: { type: 'fortnightly', sentAt: { gte: daysAgo(7) } },
    orderBy: { sentAt: 'desc' },
  })

  if (lastDigest) {
    return { skipped: true, reason: 'sent recently' }
  }

  const cutoff = daysAgo(14)
  const rawProjects = await prisma.workItem.findMany({
    where: {
      type: WorkItemType.PROJECT,
      status: { notIn: ['draft', 'archived', 'pending_review', 'needs_discussion'] },
      // A team's projects are its own, and not advertised.
      teamId: null,
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { skills: { include: { skill: true } } },
  })

  if (!rawProjects.length) {
    return { skipped: true, reason: 'no new projects' }
  }

  const projectList = rawProjects.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description ?? '',
    skill_names: p.skills.map((ps) => ps.skill.name),
    requiredSkillIds: new Set(p.skills.filter((ps) => ps.isRequired).map((ps) => ps.skillId)),
    nationalChapterId: p.nationalChapterId,
  }))

  const volunteers = await prisma.volunteer.findMany({
    where: { emailDigest: 'fortnightly', email: { not: null }, deletedAt: null },
    include: { skills: true },
  })

  let digestSent = 0
  for (const vol of volunteers) {
    const volSkillIds = new Set(vol.skills.map((vs) => vs.skillId))
    // A project is news only within its own chapter.
    const eligible = projectList.filter((p) => p.nationalChapterId === vol.nationalChapterId)
    if (!eligible.length) continue

    const enriched = eligible.map(({ requiredSkillIds, nationalChapterId: _chapter, ...rest }) => {
      let match_percent: number | undefined
      if (volSkillIds.size && requiredSkillIds.size) {
        const matched = [...requiredSkillIds].filter((id) => volSkillIds.has(id)).length
        match_percent = Math.round((matched / requiredSkillIds.size) * 100)
      }
      return { ...rest, match_percent }
    })
    enriched.sort((a, b) => (b.match_percent ?? 0) - (a.match_percent ?? 0))
    if (
      await sendDigestEmail({ to: vol.email!, name: vol.name, projects: enriched, isMatch: false })
    )
      digestSent++
  }

  await prisma.digestRun.create({ data: { type: 'fortnightly' } })
  console.log(
    `[CRON DIGEST] Sent to ${digestSent}/${volunteers.length} volunteers (${projectList.length} projects)`,
  )
  return { sent: digestSent, total: volunteers.length, projects: projectList.length }
}
