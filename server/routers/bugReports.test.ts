import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createVolunteer, createAdmin } from '@/test/factories'
import { clientAs, anon } from '@/test/rpc'
import { rateLimit } from '@/test/fakes/rate-limit'
import { emails } from '@/test/fakes/email'

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
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger)
    vi.spyOn(prisma.notification, 'create').mockRejectedValue(new Error('db') as never)
    vi.spyOn(prisma.volunteer, 'findFirst').mockRejectedValue(new Error('db') as never)
    const res = await clientAs(reporter).bugReports.create({
      title: 'x',
      description: 'Ten characters at least',
    })
    expect(res.message).toContain('Thank you')
    expect(error.mock.calls.filter((c) => c[1] === '[NOTIFY ERROR]').length).toBeGreaterThanOrEqual(
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

  it('tells the reporter, once, when their report is resolved or will not be fixed', async () => {
    const admin = await createAdmin()
    const reporter = await createVolunteer()
    const c = clientAs(admin)
    const outcomes = () =>
      prisma.notification.findMany({
        where: { volunteerId: reporter.id, type: 'bug_report_resolved' },
        orderBy: { id: 'asc' },
      })
    const report = (title: string) =>
      prisma.bugReport.create({
        data: { reporterId: reporter.id, title, description: 'Ten characters at least' },
      })

    const fixed = await report('Broken save')
    await c.admin.bugReports.update({
      id: fixed.id,
      status: 'resolved',
      resolutionNotes: 'Fixed in #400',
    })
    expect(await outcomes()).toMatchObject([
      {
        title: 'Your bug report was resolved: Broken save',
        body: 'Fixed in #400',
        link: `/bugs/${fixed.id}`,
        entityId: fixed.id,
      },
    ])
    const fixedEmail = await vi.waitFor(() => {
      const email = emails.lastTo(reporter.email!)
      expect(email).toBeDefined()
      return email!
    })
    expect(fixedEmail.subject).toBe('Your bug report was resolved: Broken save')
    expect(fixedEmail.html).toContain('Fixed in #400')
    expect(fixedEmail.html).toContain(`/bugs/${fixed.id}`)

    // Saving it again as resolved says nothing more.
    await c.admin.bugReports.update({ id: fixed.id, status: 'resolved', resolutionNotes: 'Also' })
    expect(await outcomes()).toHaveLength(1)

    const declined = await report('Make it purple')
    await c.admin.bugReports.update({ id: declined.id, status: 'wont_fix' })
    expect((await outcomes())[1]).toMatchObject({
      title: "Your bug report won't be fixed: Make it purple",
      body: null,
    })
    await vi.waitFor(() =>
      expect(emails.lastTo(reporter.email!)?.html).toContain('We have decided not to change this.'),
    )

    const unnoted = await report('Typo')
    await c.admin.bugReports.update({ id: unnoted.id, status: 'resolved' })
    await vi.waitFor(() =>
      expect(emails.lastTo(reporter.email!)?.subject).toBe('Your bug report was resolved: Typo'),
    )
    expect(emails.lastTo(reporter.email!)?.html).toContain('Thank you for reporting it.')

    const own = await prisma.bugReport.create({
      data: { reporterId: admin.id, title: 'Mine', description: 'Ten characters at least' },
    })
    const anonymous = await prisma.bugReport.create({
      data: { title: 'Nobody', description: 'Ten characters at least' },
    })
    await c.admin.bugReports.update({ id: own.id, status: 'resolved' })
    await c.admin.bugReports.update({ id: anonymous.id, status: 'wont_fix' })
    expect(
      await prisma.notification.count({
        where: { type: 'bug_report_resolved', entityId: { in: [own.id, anonymous.id] } },
      }),
    ).toBe(0)
  })
})
