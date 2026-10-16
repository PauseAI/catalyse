import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createSuperAdmin,
  createSkill,
  createChapter,
  createChapterDeputy,
  createMember,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

import { emails } from '@/test/fakes/email'

const subjects = {
  approved: 'Your Catalyse application has been approved',
  rejected: 'Update on your Catalyse application',
  needsInfo: 'Action needed on your Catalyse application',
  reopened: 'Your Catalyse application has been reopened',
}

const hashOf = (email: string) =>
  createHash('sha256').update(email.toLowerCase().trim()).digest('hex')
const status = async (id: number) =>
  (await prisma.volunteer.findUniqueOrThrow({ where: { id } })).approvalStatus

describe('admin.applications.list / getById', () => {
  it('filters by queue and attaches reviewer, skills and previous rejections', async () => {
    const me = await createSuperAdmin()
    const otherAdmin = await createSuperAdmin()
    const c = clientAs(me)
    const skill = await createSkill()
    const fresh = await createVolunteer({
      approvalStatus: 'pending',
      skills: { create: [{ skillId: skill.id }] },
    })
    const mine = await createVolunteer({ approvalStatus: 'under_review', reviewerId: me.id })
    const theirs = await createVolunteer({
      approvalStatus: 'under_review',
      reviewerId: otherAdmin.id,
    })
    const approved = await createVolunteer()
    const rejected = await createVolunteer({
      approvalStatus: 'rejected',
      rejectedAt: new Date('2026-01-01T00:00:00Z'),
    })
    const needsInfo = await createVolunteer({ approvalStatus: 'needs_info', email: null })
    await createVolunteer({ approvalStatus: 'pending', deletedAt: new Date() })
    await prisma.rejectedApplication.create({
      data: {
        emailHash: hashOf(fresh.email!),
        rejectedAt: new Date('2025-06-01'),
        adminNotes: 'earlier',
      },
    })

    const ids = async (filter: 'mine' | 'others' | 'approved' | 'rejected' | 'needs_info') =>
      (await c.admin.applications.list({ filter })).map((v) => v.id)
    expect((await ids('mine')).sort()).toEqual([fresh.id, mine.id].sort())
    expect(await ids('others')).toEqual([theirs.id])
    expect(await ids('approved')).toEqual(expect.arrayContaining([approved.id]))
    expect(await ids('rejected')).toEqual([rejected.id])
    expect(await ids('needs_info')).toEqual([needsInfo.id])

    const list = await c.admin.applications.list({})
    const f = list.find((v) => v.id === fresh.id)!
    expect(f.previousRejections).toEqual([expect.objectContaining({ adminNotes: 'earlier' })])
    expect(f.skills[0]).toMatchObject({ id: skill.id })
    expect(f.reviewer).toBeNull()
    expect(list.find((v) => v.id === mine.id)!.reviewer).toEqual({ id: me.id, name: me.name })
    const r = (await c.admin.applications.list({ filter: 'rejected' }))[0]
    expect(r.anonymiseAt).toBe('2026-01-08T00:00:00.000Z')
    const ni = (await c.admin.applications.list({ filter: 'needs_info' }))[0]
    expect(ni.previousRejections).toEqual([])
    // No emails at all → no rejection lookup.
    await prisma.volunteer.update({ where: { id: needsInfo.id }, data: { email: null } })
    expect(await c.admin.applications.list({ filter: 'needs_info' })).toHaveLength(1)

    const one = await c.admin.applications.getById({ id: fresh.id })
    expect(one.previousRejections).toHaveLength(1)
    expect(one.anonymiseAt).toBeNull()
    const noEmail = await c.admin.applications.getById({ id: needsInfo.id })
    expect(noEmail.previousRejections).toEqual([])
    expect(noEmail.reviewer).toBeNull()
    const rej = await c.admin.applications.getById({ id: rejected.id })
    expect(rej.anonymiseAt).toBe('2026-01-08T00:00:00.000Z')
    await expect(c.admin.applications.getById({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('admin.applications by chapter', () => {
  it("lets chapter staff decide their own chapter's applications only", async () => {
    const [mine, theirs] = [await createChapter(), await createChapter()]
    const deputy = clientAs(await createChapterDeputy(mine))
    const pending = { approvalStatus: 'pending' as const }
    const ours = await createMember(mine, pending)
    const foreign = await createMember(theirs, pending)
    const pooled = await createVolunteer(pending)

    const listed = (await deputy.admin.applications.list({})).map((a) => a.id)
    expect(listed).toContain(ours.id)
    expect(listed).not.toContain(foreign.id)
    expect(listed).not.toContain(pooled.id)
    // Asking for another chapter or the pool still gives their own.
    expect((await deputy.admin.applications.list({ chapter: 'pool' })).map((a) => a.id)).toEqual(
      listed,
    )
    for (const id of [foreign.id, pooled.id]) {
      await expect(deputy.admin.applications.getById({ id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
      await expect(
        deputy.admin.applications.action({ id, action: 'approve' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await deputy.admin.applications.action({ id: ours.id, action: 'approve' })).toEqual({
      message: 'Application approved',
    })
  })

  it('lets a global admin see every chapter, one, or the pool', async () => {
    const chapter = await createChapter()
    const admin = clientAs(await createSuperAdmin())
    const pending = { approvalStatus: 'pending' as const }
    const member = await createMember(chapter, pending)
    const pooled = await createVolunteer(pending)
    const all = (await admin.admin.applications.list({})).map((a) => a.id)
    expect(all).toEqual(expect.arrayContaining([member.id, pooled.id]))
    expect((await admin.admin.applications.list({ chapter: chapter.id })).map((a) => a.id)).toEqual(
      [member.id],
    )
    const pool = (await admin.admin.applications.list({ chapter: 'pool' })).map((a) => a.id)
    expect(pool).toContain(pooled.id)
    expect(pool).not.toContain(member.id)
  })
})

describe('admin.applications.action', () => {
  it('update_notes, start_review, request_info', async () => {
    const me = await createSuperAdmin()
    const c = clientAs(me)
    await expect(
      c.admin.applications.action({ id: 999_999, action: 'approve' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const v = await createVolunteer({ approvalStatus: 'pending' })
    expect(
      await c.admin.applications.action({
        id: v.id,
        action: 'update_notes',
        adminNotes: 'a',
        applicantNotes: 'b',
      }),
    ).toEqual({ message: 'Notes updated' })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({
      applicationAdminNotes: 'a',
      applicationApplicantNotes: 'b',
    })
    await c.admin.applications.action({ id: v.id, action: 'update_notes', adminNotes: null })

    expect(await c.admin.applications.action({ id: v.id, action: 'start_review' })).toEqual({
      message: 'Review started',
    })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({
      approvalStatus: 'under_review',
      reviewerId: me.id,
    })
    await c.admin.applications.action({
      id: v.id,
      action: 'start_review',
      adminNotes: 'x',
      applicantNotes: 'y',
    })

    expect(
      await c.admin.applications.action({
        id: v.id,
        action: 'request_info',
        applicantNotes: 'tell us more',
      }),
    ).toEqual({ message: 'More information requested' })
    expect(await status(v.id)).toBe('needs_info')
    expect(emails.last).toMatchObject({ to: v.email, subject: subjects.needsInfo })
    expect(emails.last.html).toContain('tell us more')
    await expect(
      c.admin.applications.action({ id: v.id, action: 'start_review' }),
    ).rejects.toMatchObject({ message: 'Cannot start review on a needs_info application' })
    await expect(
      c.admin.applications.action({ id: v.id, action: 'request_info' }),
    ).rejects.toMatchObject({ message: 'Cannot request info on a needs_info application' })
    await expect(c.admin.applications.action({ id: v.id, action: 'reopen' })).rejects.toMatchObject(
      { message: 'Cannot reopen a needs_info application' },
    )

    // Without an email nothing is sent; with stored notes they are reused.
    const quiet = await createVolunteer({
      approvalStatus: 'pending',
      email: null,
      applicationApplicantNotes: 'stored',
    })
    await c.admin.applications.action({
      id: quiet.id,
      action: 'request_info',
      adminNotes: 'n',
      applicantNotes: 'p',
    })
    expect(emails.sent).toHaveLength(1)
    const stored = await createVolunteer({
      approvalStatus: 'pending',
      applicationApplicantNotes: 'stored',
    })
    await c.admin.applications.action({ id: stored.id, action: 'request_info' })
    expect(emails.last.html).toContain('stored')
  })

  it('approve, reject, reopen — with emails and notification clean-up', async () => {
    const me = await createSuperAdmin()
    const c = clientAs(me)
    const a = await createVolunteer({ approvalStatus: 'pending' })
    await prisma.notification.create({
      data: { volunteerId: me.id, type: 'new_volunteer_signup', title: 't', entityId: a.id },
    })
    expect(await c.admin.applications.action({ id: a.id, action: 'approve' })).toEqual({
      message: 'Application approved',
    })
    expect(await status(a.id)).toBe('approved')
    expect(emails.last).toMatchObject({ to: a.email, subject: subjects.approved })
    expect(emails.last.html).toContain(a.name)
    expect(
      await prisma.notification.count({ where: { type: 'new_volunteer_signup', entityId: a.id } }),
    ).toBe(0)
    await expect(c.admin.applications.action({ id: a.id, action: 'reject' })).rejects.toMatchObject(
      { message: 'Application already approved' },
    )
    // Approval is announced once, and points at the projects once the email is confirmed.
    await expect(
      c.admin.applications.action({ id: a.id, action: 'approve' }),
    ).rejects.toMatchObject({ message: 'Application already approved' })
    expect(
      await prisma.notification.findMany({
        where: { volunteerId: a.id, type: 'application_approved' },
      }),
    ).toEqual([
      expect.objectContaining({ title: 'Approved: welcome to Catalyse', link: '/projects' }),
    ])
    const unconfirmed = await createVolunteer({ approvalStatus: 'pending', emailConfirmed: false })
    await c.admin.applications.action({ id: unconfirmed.id, action: 'approve' })
    expect(
      await prisma.notification.findFirstOrThrow({
        where: { volunteerId: unconfirmed.id, type: 'application_approved' },
      }),
    ).toMatchObject({ link: '/verify-email' })
    expect(
      await prisma.notification.count({
        where: { type: 'application_approved', volunteerId: { in: [a.id, unconfirmed.id] } },
      }),
    ).toBe(2)

    const r = await createVolunteer({ approvalStatus: 'needs_info' })
    expect(
      await c.admin.applications.action({
        id: r.id,
        action: 'reject',
        applicantNotes: 'sorry',
        adminNotes: 'weak',
      }),
    ).toEqual({ message: 'Application rejected' })
    const rRow = await prisma.volunteer.findUniqueOrThrow({ where: { id: r.id } })
    expect(rRow.rejectedAt).not.toBeNull()
    expect(emails.last).toMatchObject({ to: r.email, subject: subjects.rejected })
    expect(emails.last.html).toContain('sorry')

    expect(
      await c.admin.applications.action({
        id: r.id,
        action: 'reopen',
        adminNotes: 'second look',
        applicantNotes: 'welcome back',
      }),
    ).toEqual({ message: 'Application reopened' })
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({
      approvalStatus: 'needs_info',
      rejectedAt: null,
    })
    expect(emails.last).toMatchObject({ to: r.email, subject: subjects.reopened })
    expect(emails.last.html).toContain('welcome back')

    // Email-less volunteers skip every send.
    const silent = await createVolunteer({ approvalStatus: 'pending', email: null })
    await c.admin.applications.action({ id: silent.id, action: 'reject' })
    await c.admin.applications.action({ id: silent.id, action: 'reopen' })
    await c.admin.applications.action({ id: silent.id, action: 'approve' })
    expect(emails.sent.map((e) => e.subject)).toEqual([
      subjects.approved,
      subjects.approved,
      subjects.rejected,
      subjects.reopened,
    ])
  })

  it('logs but does not fail when an email send rejects', async () => {
    const me = await createSuperAdmin()
    const c = clientAs(me)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    emails.failNext(4)
    const v = await createVolunteer({ approvalStatus: 'pending' })
    await c.admin.applications.action({ id: v.id, action: 'request_info' })
    await c.admin.applications.action({ id: v.id, action: 'reject' })
    await c.admin.applications.action({ id: v.id, action: 'reopen' })
    await c.admin.applications.action({ id: v.id, action: 'approve' })
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(4))
    expect(error.mock.calls.map((c) => c[0])).toEqual([
      '[APPLICATIONS] Needs-info email failed:',
      '[APPLICATIONS] Rejected email failed:',
      '[APPLICATIONS] Reopened email failed:',
      '[APPLICATIONS] Approved email failed:',
    ])
  })
})
