import { prisma } from './prisma'
import { sendDigestEmail, isEmailConfigured } from './email'
import { calculateMatchScore, matchGradeLabel, MATCH_GRADES } from './matching'
import { WorkItemType } from '@/generated/prisma/enums'

const NOTIFIABLE_GRADES = new Set(MATCH_GRADES.filter((g) => g.notifiable).map((g) => g.label))

// Emails volunteers who asked for immediate skill-match alerts (emailDigest: 'match')
// as soon as a project they're at least a good fit for goes live — either an admin
// approves a volunteer-proposed project, or an admin publishes an org-proposed one directly.
export async function notifyMatchingVolunteers(projectId: number): Promise<void> {
  if (!isEmailConfigured()) return

  const project = await prisma.workItem.findFirst({
    where: { id: projectId, type: WorkItemType.PROJECT },
    include: { skills: { include: { skill: true } } },
  })
  if (!project) return

  const projectSkills = project.skills.map((ps) => ({ id: ps.skillId, isRequired: ps.isRequired }))
  const requiredSkillIds = project.skills.filter((ps) => ps.isRequired).map((ps) => ps.skillId)
  if (!requiredSkillIds.length) return

  const volunteers = await prisma.volunteer.findMany({
    where: {
      emailDigest: 'match',
      email: { not: null },
      deletedAt: null,
      // A project is news only within its own chapter.
      nationalChapterId: project.nationalChapterId,
      skills: { some: { skillId: { in: requiredSkillIds } } },
    },
    include: { skills: true },
  })
  if (!volunteers.length) return

  const skillNames = project.skills.map((ps) => ps.skill.name)

  await Promise.all(
    volunteers.map((vol) => {
      const volSkillIds = new Set(vol.skills.map((vs) => vs.skillId))
      const score = calculateMatchScore(volSkillIds, projectSkills)
      const grade = matchGradeLabel(score.matchedRequiredCount)
      if (!grade || !NOTIFIABLE_GRADES.has(grade)) return

      return sendDigestEmail({
        to: vol.email!,
        name: vol.name,
        projects: [
          {
            id: project.id,
            title: project.title,
            description: project.description ?? '',
            skill_names: skillNames,
            match_percent: score.requiredMatchPercent,
          },
        ],
        isMatch: true,
      }).catch((e) => console.error('[MATCH NOTIFY ERROR]', e))
    }),
  )
}
