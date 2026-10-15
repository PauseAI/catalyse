import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createAdmin } from '@/test/factories'
import { clientAs, anon } from '@/test/rpc'
import { rateLimit } from '@/test/fakes/rate-limit'

const denyNextRequest = () => rateLimit.denyNext(1000)

const waitForNotification = (volunteerId: number, type: string, count = 1) =>
  vi.waitFor(async () =>
    expect(await prisma.notification.count({ where: { volunteerId, type } })).toBe(count),
  )

describe('bugReports', () => {
  it('refuses a report from nobody', async () => {
    await expect(
      anon().bugReports.create({ title: 'Anon', description: 'From nobody', category: 'bug' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('creates a report, notifying the reporter and admins (technical admins by email too)', async () => {
    const reporter = await createVolunteer()
    const admin = await createAdmin()
    const techAdmin = await createAdmin({ isTechnicalAdmin: true })
    const { id } = await clientAs(reporter).bugReports.create({
      title: '  Broken  ',
      description: 'Something is broken here',
    })
    expect(await prisma.bugReport.findUniqueOrThrow({ where: { id } })).toMatchObject({
      title: 'Broken',
      category: 'bug',
      severity: 'medium',
      pageUrl: null,
      reporterEmail: reporter.email,
    })
    await waitForNotification(reporter.id, 'bug_report_submitted')
    await waitForNotification(admin.id, 'new_bug_report')
    await waitForNotification(techAdmin.id, 'new_bug_report')

    const full = await clientAs(reporter).bugReports.create({
      title: 'UX',
      description: 'Ten characters at least',
      pageUrl: 'https://x/y',
      category: 'ux',
      severity: 'low',
    })
    expect(await prisma.bugReport.findUniqueOrThrow({ where: { id: full.id } })).toMatchObject({
      category: 'ux',
      severity: 'low',
      pageUrl: 'https://x/y',
    })
  })

  it('still returns success when notifications fail to write', async () => {
    const reporter = await createVolunteer()
    await createAdmin()
    await createAdmin({ isTechnicalAdmin: true })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(prisma.notification, 'create').mockRejectedValue(new Error('db') as never)
    vi.spyOn(prisma.volunteer, 'findFirst').mockRejectedValue(new Error('db') as never)
    const res = await clientAs(reporter).bugReports.create({
      title: 'x',
      description: 'Ten characters at least',
    })
    expect(res.message).toContain('Thank you')
    expect(error.mock.calls.filter((c) => c[0] === '[NOTIFY ERROR]').length).toBeGreaterThanOrEqual(
      3,
    )
    vi.restoreAllMocks()
  })

  it('is rate limited', async () => {
    const reporter = await createVolunteer()
    denyNextRequest()
    await expect(
      clientAs(reporter).bugReports.create({ title: 'x', description: 'Ten characters at least' }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
  })

  it('getById shows a report to its reporter and admins only', async () => {
    const reporter = await createVolunteer()
    const other = await createVolunteer()
    const admin = await createAdmin()
    const { id } = await clientAs(reporter).bugReports.create({
      title: 'T',
      description: 'Ten characters at least',
    })
    await prisma.bugReport.update({ where: { id }, data: { assigneeId: admin.id } })
    const mine = await clientAs(reporter).bugReports.getById({ id })
    expect(mine).toMatchObject({
      isMine: true,
      reporterName: reporter.name,
      assigneeName: admin.name,
    })
    expect((await clientAs(admin).bugReports.getById({ id })).isMine).toBe(false)
    await expect(clientAs(other).bugReports.getById({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(clientAs(other).bugReports.getById({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })

    const anonReport = await prisma.bugReport.create({
      data: { title: 'a', description: 'Ten characters at least' },
    })
    expect(await clientAs(admin).bugReports.getById({ id: anonReport.id })).toMatchObject({
      reporterName: null,
      assigneeName: null,
    })
  })
})

describe('bugReportComments', () => {
  it('lists for the reporter and admins, and refuses others', async () => {
    const reporter = await createVolunteer()
    const other = await createVolunteer()
    const admin = await createAdmin()
    const { id } = await clientAs(reporter).bugReports.create({
      title: 'T',
      description: 'Ten characters at least',
    })
    await expect(clientAs(other).bugReportComments.list({ bugReportId: id })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    )
    await expect(
      clientAs(other).bugReportComments.list({ bugReportId: 999_999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await clientAs(admin).bugReportComments.list({ bugReportId: id })).toEqual({
      canPost: true,
      comments: [],
    })
  })

  it('adds comments with the right notifications each way', async () => {
    const reporter = await createVolunteer()
    const other = await createVolunteer()
    const admin = await createAdmin()
    const { id } = await clientAs(reporter).bugReports.create({
      title: 'T',
      description: 'Ten characters at least',
    })
    await waitForNotification(admin.id, 'new_bug_report')

    await expect(
      clientAs(other).bugReportComments.add({ bugReportId: id, content: 'hi' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      clientAs(other).bugReportComments.add({ bugReportId: 999_999, content: 'hi' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const c1 = await clientAs(reporter).bugReportComments.add({
      bugReportId: id,
      content: '  from reporter ',
    })
    expect(c1).toMatchObject({ message: 'Comment added' })
    await waitForNotification(admin.id, 'bug_report_comment')

    await clientAs(admin).bugReportComments.add({ bugReportId: id, content: 'from admin' })
    await waitForNotification(reporter.id, 'bug_report_comment_reply')

    // An admin replying on their own report does not notify themselves.
    const own = await clientAs(admin).bugReports.create({
      title: 'Own',
      description: 'Ten characters at least',
    })
    await clientAs(admin).bugReportComments.add({ bugReportId: own.id, content: 'note' })
    expect(
      await prisma.notification.count({
        where: { volunteerId: admin.id, type: 'bug_report_comment_reply' },
      }),
    ).toBe(0)

    const { comments } = await clientAs(reporter).bugReportComments.list({ bugReportId: id })
    expect(comments.map((c) => [c.authorName, c.content])).toEqual([
      [reporter.name, 'from reporter'],
      [admin.name, 'from admin'],
    ])
  })

  it('lets the author edit, and the author or an admin delete', async () => {
    const reporter = await createVolunteer()
    const admin = await createAdmin()
    const { id: bugReportId } = await clientAs(reporter).bugReports.create({
      title: 'T',
      description: 'Ten characters at least',
    })
    const mine = await clientAs(reporter).bugReportComments.add({ bugReportId, content: 'mine' })
    const theirs = await clientAs(admin).bugReportComments.add({ bugReportId, content: 'theirs' })

    await expect(
      clientAs(admin).bugReportComments.edit({ id: mine.id, content: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      clientAs(reporter).bugReportComments.edit({ id: 999_999, content: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      clientAs(reporter).bugReportComments.delete({ id: theirs.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect(
      await clientAs(reporter).bugReportComments.edit({ id: mine.id, content: ' edited ' }),
    ).toMatchObject({ message: 'Comment updated' })
    let { comments } = await clientAs(reporter).bugReportComments.list({ bugReportId })
    expect(comments[0]).toMatchObject({ content: 'edited', canEdit: true, canDelete: true })
    expect(comments[0].editedAt).not.toBeNull()
    expect(comments[1]).toMatchObject({ canEdit: false, canDelete: false })

    await clientAs(reporter).bugReportComments.delete({ id: mine.id })
    expect(await clientAs(admin).bugReportComments.delete({ id: theirs.id })).toMatchObject({
      message: 'Comment deleted',
    })
    await expect(
      clientAs(reporter).bugReportComments.delete({ id: mine.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    ;({ comments } = await clientAs(reporter).bugReportComments.list({ bugReportId }))
    expect(comments).toMatchObject([
      { deleted: true, content: '', canDelete: false },
      { deleted: true, content: '', canDelete: false },
    ])
  })
})

describe('admin.bugReports', () => {
  it('lists with filters, assigns to approved volunteers, and updates status', async () => {
    const admin = await createAdmin()
    const reporter = await createVolunteer()
    const c = clientAs(admin)
    const { id } = await clientAs(reporter).bugReports.create({
      title: 'T',
      description: 'Ten characters at least',
      category: 'feature',
    })
    await waitForNotification(admin.id, 'new_bug_report')
    await prisma.bugReport.create({
      data: { title: 'anon', description: 'Ten characters at least', status: 'resolved' },
    })

    const all = await c.admin.bugReports.list({})
    expect(all.find((r) => r.id === id)).toMatchObject({
      reporterName: reporter.name,
      assigneeName: null,
    })
    expect((await c.admin.bugReports.list({ status: 'resolved' })).map((r) => r.title)).toEqual([
      'anon',
    ])
    expect((await c.admin.bugReports.list({ category: 'feature' })).map((r) => r.id)).toEqual([id])

    await expect(
      c.admin.bugReports.assign({ id: 999_999, volunteerId: reporter.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(c.admin.bugReports.assign({ id, volunteerId: 999_999 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Volunteer not found',
    })
    const pending = await createVolunteer({ approvalStatus: 'pending' })
    await expect(c.admin.bugReports.assign({ id, volunteerId: pending.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(await c.admin.bugReports.assign({ id, volunteerId: reporter.id })).toEqual({
      message: 'Bug report assigned',
    })
    expect((await c.admin.bugReports.list({ category: 'feature' }))[0].assigneeName).toBe(
      reporter.name,
    )

    await expect(c.admin.bugReports.update({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await c.admin.bugReports.update({ id })).toEqual({ message: 'Bug report updated' })
    await c.admin.bugReports.update({ id, status: 'in_progress', resolutionNotes: 'looking' })
    expect(await prisma.bugReport.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'in_progress',
      resolutionNotes: 'looking',
      resolvedById: null,
    })
    await c.admin.bugReports.update({ id, status: 'resolved' })
    expect(await prisma.bugReport.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'resolved',
      resolvedById: admin.id,
    })
    expect(
      await prisma.notification.count({ where: { type: 'new_bug_report', entityId: id } }),
    ).toBe(0)
  })
})
