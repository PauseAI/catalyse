import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createProject, createSkill, createChapter } from '@/test/factories'

import { emails } from '@/test/fakes/email'
import { logger } from './logger'
import { notifyMatchingVolunteers } from './project-match-notify'

afterEach(() => {
  vi.restoreAllMocks()
})

async function skills(n: number) {
  const out = []
  for (let i = 0; i < n; i++) out.push(await createSkill())
  return out
}

describe('notifyMatchingVolunteers', () => {
  it('does nothing when email is off, the project is missing, or it has no required skills', async () => {
    emails.setConfigured(false)
    await notifyMatchingVolunteers(1)
    emails.setConfigured(true)
    await notifyMatchingVolunteers(999_999)
    const [s] = await skills(1)
    const p = await createProject({ skills: { create: [{ skillId: s.id, isRequired: false }] } })
    await notifyMatchingVolunteers(p.id)
    expect(emails.sent).toEqual([])
  })

  it("emails opted-in volunteers in the project's chapter at a notifiable grade", async () => {
    const [a, b, c] = await skills(3)
    const [home, away] = [await createChapter(), await createChapter()]
    const p = await createProject({
      nationalChapterId: home.id,
      reach: 'REMOTE',
      description: null,
      skills: { create: [a, b, c].map((s) => ({ skillId: s.id, isRequired: true })) },
    })
    const mk = (over: Parameters<typeof createVolunteer>[0], ids: number[]) =>
      createVolunteer({
        emailDigest: 'match',
        nationalChapterId: home.id,
        skills: { create: ids.map((skillId) => ({ skillId })) },
        ...over,
      })
    const good = await mk({}, [a.id, b.id])
    await mk({}, [a.id]) // partial: not notifiable
    await mk({ nationalChapterId: away.id }, [a.id, b.id]) // another chapter, remote or not
    await mk({ nationalChapterId: null }, [a.id, b.id]) // the holding pool
    await mk({ emailDigest: 'none' }, [a.id, b.id]) // not opted in
    await notifyMatchingVolunteers(p.id)
    expect(emails.sent).toHaveLength(1)
    expect(emails.last.to).toBe(good.email)
    expect(emails.last.html).toContain('match your skills')
    expect(emails.last.html).toContain('67% match')
    expect(emails.last.html).toContain(`/projects/${p.id}`)
  })

  it('is a no-op with no candidate volunteers, and logs a failed send', async () => {
    const [a] = await skills(1)
    const p = await createProject({ skills: { create: [{ skillId: a.id, isRequired: true }] } })
    await notifyMatchingVolunteers(p.id)
    expect(emails.sent).toEqual([])

    const [b, c] = await skills(2)
    const p2 = await createProject({
      skills: { create: [b, c].map((s) => ({ skillId: s.id, isRequired: true })) },
    })
    await createVolunteer({
      emailDigest: 'match',
      skills: { create: [{ skillId: b.id }, { skillId: c.id }] },
    })
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger as never)
    emails.failNext()
    await notifyMatchingVolunteers(p2.id)
    expect(error).toHaveBeenCalledWith(expect.any(Error), '[MATCH NOTIFY ERROR]')
    expect(await prisma.workItem.count({ where: { id: p2.id } })).toBe(1)
  })
})
