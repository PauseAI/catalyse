import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createAdmin, createProject, createVolunteer } from '@/test/factories'
import { clientAs } from '@/test/rpc'

/** A proposal an admin has sent back with a message. */
async function sentBack() {
  const admin = await createAdmin()
  const creator = await createVolunteer()
  const project = await createProject({ status: 'pending_review', creatorId: creator.id })
  await clientAs(admin).admin.projects.review({
    id: project.id,
    status: 'needs_discussion',
    comment: 'Add tasks',
  })
  await vi.waitFor(async () =>
    expect(
      await prisma.notification.count({
        where: { type: 'project_needs_discussion', entityId: project.id },
      }),
    ).toBe(1),
  )
  return { admin, creator, project }
}

describe('projects.resubmit', () => {
  it('sends the proposal back to review, closes the request and tells the admin who asked', async () => {
    const { admin, creator, project } = await sentBack()
    const other = await createVolunteer()

    await expect(clientAs(creator).projects.resubmit({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(clientAs(other).projects.resubmit({ id: project.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(await clientAs(creator).projects.resubmit({ id: project.id })).toEqual({
      message: 'Project resubmitted for review',
    })
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: project.id } })).status).toBe(
      'pending_review',
    )
    expect(
      await prisma.projectReviewRequest.count({
        where: { projectId: project.id, resolvedAt: null },
      }),
    ).toBe(0)
    expect(
      await prisma.notification.count({
        where: { type: 'project_needs_discussion', entityId: project.id },
      }),
    ).toBe(0)
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findFirst({
          where: { type: 'project_resubmitted', entityId: project.id },
        }),
      ).toMatchObject({
        volunteerId: admin.id,
        title: `Resubmitted: '${project.title}' is ready for another look`,
        link: `/projects/${project.id}`,
      }),
    )

    // Only a project waiting on changes can be resubmitted.
    await expect(clientAs(creator).projects.resubmit({ id: project.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })

    // Approving clears the admin's "resubmitted" notice.
    await clientAs(admin).admin.projects.review({ id: project.id, status: 'approved' })
    expect(
      await prisma.notification.count({
        where: { type: 'project_resubmitted', entityId: project.id },
      }),
    ).toBe(0)
  })

  it('lets the owner resubmit, and tells every admin when the requester is gone', async () => {
    const { admin, project } = await sentBack()
    const owner = await createVolunteer()
    await prisma.workItem.update({ where: { id: project.id }, data: { assigneeId: owner.id } })
    await prisma.volunteer.update({ where: { id: admin.id }, data: { deletedAt: new Date() } })
    const otherAdmin = await createAdmin()

    await clientAs(owner).projects.resubmit({ id: project.id })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findFirst({
          where: { type: 'project_resubmitted', entityId: project.id, volunteerId: otherAdmin.id },
        }),
      ).not.toBeNull(),
    )
  })
})

describe('projects.getById reviewRequests', () => {
  it('shows every round to the proposer, owner and admins only', async () => {
    const { admin, creator, project } = await sentBack()
    await clientAs(creator).projects.resubmit({ id: project.id })
    await clientAs(admin).admin.projects.review({
      id: project.id,
      status: 'needs_discussion',
      comment: 'Now add a deadline',
    })

    const mine = await clientAs(creator).projects.getById({ id: project.id })
    expect(mine.reviewRequests.map((r) => [r.message, r.resolvedAt === null])).toEqual([
      ['Now add a deadline', true],
      ['Add tasks', false],
    ])
    expect(mine.reviewRequests[0].requestedByName).toBe(admin.name)
    expect(
      (await clientAs(await createAdmin()).projects.getById({ id: project.id })).reviewRequests,
    ).toHaveLength(2)

    // Once live, a stranger can see the project but not its review history.
    await clientAs(admin).admin.projects.review({ id: project.id, status: 'approved' })
    const stranger = await createVolunteer()
    expect((await clientAs(stranger).projects.getById({ id: project.id })).reviewRequests).toEqual(
      [],
    )
  })
})
