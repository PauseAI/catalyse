import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { globalAdminWhere } from '@/lib/chapter-access-server'
import { sendPendingApplicationsSummaryEmail } from '@/lib/email'
import { APPLICATION_ANONYMISATION_MS } from '@/lib/applications'
import { ApprovalStatus } from '@/generated/prisma/enums'

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export async function runApplicationsSummaryJob(): Promise<Record<string, unknown>> {
  const sentToday = await prisma.applicationsSummaryRun.findFirst({
    where: { sentAt: { gte: startOfToday() } },
  })
  if (sentToday) return { skipped: true, reason: 'already sent today' }

  const count = await prisma.volunteer.count({
    where: {
      approvalStatus: { in: [ApprovalStatus.pending, ApprovalStatus.under_review] },
      deletedAt: null,
    },
  })

  if (!count) return { skipped: true, reason: 'no pending applications' }

  const admins = await prisma.volunteer.findMany({
    where: globalAdminWhere(),
    select: { name: true, email: true },
  })

  let sent = 0
  for (const admin of admins) {
    if (admin.email) {
      await sendPendingApplicationsSummaryEmail({ to: admin.email, name: admin.name, count }).catch(
        (e) => console.error('[APPLICATIONS SUMMARY] Email failed:', e),
      )
      sent++
    }
  }

  await prisma.applicationsSummaryRun.create({ data: {} })
  return { sent, pending: count }
}

export async function runApplicationsAnonymisationJob(): Promise<Record<string, unknown>> {
  const cutoff = new Date(Date.now() - APPLICATION_ANONYMISATION_MS)

  const toAnonymise = await prisma.volunteer.findMany({
    where: {
      approvalStatus: ApprovalStatus.rejected,
      rejectedAt: { lte: cutoff },
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      rejectedAt: true,
      applicationAdminNotes: true,
      applicationApplicantNotes: true,
    },
  })

  if (!toAnonymise.length) return { skipped: true, reason: 'no applications due for anonymisation' }

  let anonymised = 0
  for (const v of toAnonymise) {
    if (v.email) {
      const emailHash = createHash('sha256').update(v.email.toLowerCase().trim()).digest('hex')
      await prisma.rejectedApplication.create({
        data: {
          emailHash,
          rejectedAt: v.rejectedAt ?? new Date(),
          adminNotes: v.applicationAdminNotes,
          applicantNotes: v.applicationApplicantNotes,
        },
      })
      await prisma.anonymisedEmail.upsert({
        where: { emailHash },
        create: { emailHash },
        update: {},
      })
    }

    await prisma.volunteer.update({
      where: { id: v.id },
      data: {
        name: '[Deleted User]',
        email: null,
        bio: null,
        discordHandle: null,
        signalNumber: null,
        whatsappNumber: null,
        contactNotes: null,
        location: null,
        otherSkills: null,
        authToken: null,
        passwordHash: null,
        applicationMessage: null,
        applicationAdminNotes: null,
        applicationApplicantNotes: null,
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    })

    anonymised++
  }

  return { anonymised }
}
