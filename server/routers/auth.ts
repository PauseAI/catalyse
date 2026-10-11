import { ORPCError } from '@orpc/server'
import { randomBytes, createHash } from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  verifyPassword,
  hashPassword,
  generateAuthToken,
  createSession,
  deleteSession,
  deleteAllSessions,
  deleteOtherSessions,
  promoteIfEntitled,
  isEntitledToAdmin,
  revokeCredentials,
  redactVolunteer,
} from '@/lib/auth'
import {
  html,
  rawHtml,
  sendWelcomeEmail,
  sendWelcomeAndConfirmEmail,
  sendPasswordResetEmail,
  sendApplicationReceivedEmail,
  sendApplicationApprovedEmail,
} from '@/lib/email'
import { checkRateLimit } from '@/lib/rate-limit'
import { verifyGoogleToken } from '@/lib/google-auth'
import { notifyAdmins } from '@/lib/notify'
import {
  SignupSchema,
  CompleteGoogleSignupSchema,
  ChangePasswordSchema,
  ChangeEmailSchema,
  ResetPasswordSchema,
  sanitisePersonName,
} from '@/lib/schemas'
import { publicProcedure, authedProcedure } from '../procedures'
import { env } from '@/lib/env'
import { ApprovalStatus, ProjectStatus, WorkItemType } from '@/generated/prisma/enums'

// Google sign-in is stubbed when asked, or when no client id is set outside production.
const stubGoogle = () => env.STUB_GOOGLE || (!env.GOOGLE_CLIENT_ID && env.NODE_ENV !== 'production')

async function sendAccountDeletionNotifications(deletedId: number, deletedName: string) {
  const taskRows = await prisma.$queryRaw<
    Array<{
      owner_id: number
      owner_name: string
      owner_email: string | null
      project_id: number
      project_title: string
      task_count: number
    }>
  >`
    SELECT p.assignee_id AS owner_id, v.name AS owner_name, v.email AS owner_email,
           p.id AS project_id, p.title AS project_title,
           COUNT(qt.id) AS task_count
    FROM work_items qt
    JOIN work_items p ON qt.context_project_id = p.id AND p.type = 'PROJECT'
    JOIN volunteers v ON p.assignee_id = v.id
    WHERE qt.type = 'QUICK_TASK'
      AND qt.assignee_id = ${deletedId}
      AND qt.status NOT IN ('completed')
      AND p.assignee_id != ${deletedId}
      AND v.deleted_at IS NULL
    GROUP BY p.id, v.id
  `
  const ownedProjects = await prisma.workItem.findMany({
    where: {
      type: WorkItemType.PROJECT,
      assigneeId: deletedId,
      status: { notIn: [ProjectStatus.completed, ProjectStatus.archived] },
    },
    select: { id: true, title: true },
  })
  if (!taskRows.length && !ownedProjects.length) return

  type Recipient = {
    name: string
    email: string | null
    taskProjects: { projectId: number; projectTitle: string; taskCount: number }[]
    ownerlessProjects: { projectId: number; projectTitle: string }[]
  }
  const recipients: Record<number, Recipient> = {}

  for (const row of taskRows) {
    if (!recipients[row.owner_id]) {
      recipients[row.owner_id] = {
        name: row.owner_name,
        email: row.owner_email,
        taskProjects: [],
        ownerlessProjects: [],
      }
    }
    recipients[row.owner_id].taskProjects.push({
      projectId: row.project_id,
      projectTitle: row.project_title,
      taskCount: Number(row.task_count),
    })
  }

  const ownerless = ownedProjects.map((p) => ({ projectId: p.id, projectTitle: p.title }))
  if (ownerless.length) {
    const admins = await prisma.volunteer.findMany({
      where: { isAdmin: true, deletedAt: null, id: { not: deletedId } },
      select: { id: true, name: true, email: true },
    })
    for (const admin of admins) {
      if (!recipients[admin.id])
        recipients[admin.id] = {
          name: admin.name,
          email: admin.email,
          taskProjects: [],
          ownerlessProjects: [],
        }
      recipients[admin.id].ownerlessProjects = ownerless
    }
  }

  const { sendProjectNotificationEmail } = await import('@/lib/email')
  for (const [recipientId, r] of Object.entries(recipients)) {
    const rid = Number(recipientId)
    for (const p of r.taskProjects) {
      const word = p.taskCount === 1 ? 'task' : 'tasks'
      await prisma.notification
        .create({
          data: {
            volunteerId: rid,
            type: 'account_deleted_impact',
            title: `${deletedName} has deleted their account`,
            body: `${p.taskCount} ${word} in '${p.projectTitle}' assigned to ${deletedName} need a new assignee.`,
            link: `/projects/${p.projectId}`,
          },
        })
        .catch((e) => console.error('[NOTIFY ERROR]', e))
    }
    for (const p of r.ownerlessProjects) {
      await prisma.notification
        .create({
          data: {
            volunteerId: rid,
            type: 'account_deleted_impact',
            title: `${deletedName} has deleted their account`,
            body: `'${p.projectTitle}' needs a new owner.`,
            link: `/projects/${p.projectId}`,
          },
        })
        .catch((e) => console.error('[NOTIFY ERROR]', e))
    }
    if (r.email) {
      const allProjects = [...r.taskProjects, ...r.ownerlessProjects]
      const msgParts = [html`<p><strong>${deletedName}</strong> has deleted their account.</p>`]
      if (r.taskProjects.length)
        msgParts.push(
          html`<p>The following tasks need a new assignee:</p>
            <ul>
              ${rawHtml(
                r.taskProjects
                  .map(
                    (p) =>
                      html`<li>
                        ${p.taskCount} ${p.taskCount === 1 ? 'task' : 'tasks'} in
                        <strong>${p.projectTitle}</strong>
                      </li>`,
                  )
                  .join(''),
              )}
            </ul>`,
        )
      if (r.ownerlessProjects.length)
        msgParts.push(
          html`<p>The following projects need a new owner:</p>
            <ul>
              ${rawHtml(
                r.ownerlessProjects
                  .map((p) => html`<li><strong>${p.projectTitle}</strong></li>`)
                  .join(''),
              )}
            </ul>`,
        )
      await sendProjectNotificationEmail({
        to: r.email,
        name: r.name,
        subject: `${deletedName} has deleted their account`,
        message: msgParts.join(''),
        projectTitle: allProjects[0].projectTitle,
        projectId: allProjects[0].projectId,
      }).catch((e) => console.error('[NOTIFY ERROR] email failed:', e))
    }
  }
}

const EMAIL_CHANGES_PER_DAY = 3
const DAY_MS = 24 * 60 * 60 * 1000

// Each change mails a confirmation link to an address nobody has proven, carrying the
// account's name, so it is rationed per account: an IP limit resets with every deploy and
// does nothing against one account used from many places. Conditional updates, so
// concurrent requests cannot both take the last slot.
async function claimEmailChange(volunteerId: number): Promise<boolean> {
  const now = new Date()
  const newWindow = await prisma.volunteer.updateMany({
    where: {
      id: volunteerId,
      OR: [
        { emailChangeWindowStart: null },
        { emailChangeWindowStart: { lt: new Date(now.getTime() - DAY_MS) } },
      ],
    },
    data: { emailChangeCount: 1, emailChangeWindowStart: now },
  })
  if (newWindow.count === 1) return true
  const sameWindow = await prisma.volunteer.updateMany({
    where: { id: volunteerId, emailChangeCount: { lt: EMAIL_CHANGES_PER_DAY } },
    data: { emailChangeCount: { increment: 1 } },
  })
  return sameWindow.count === 1
}

export const authRouter = {
  login: publicProcedure
    .input(z.object({ email: z.string(), password: z.string() }))
    .handler(async ({ input, context }) => {
      const { allowed, retryAfterMs } = checkRateLimit(context.request, 'login', {
        limit: 10,
        windowMs: 15 * 60 * 1000,
      })
      if (!allowed)
        throw new ORPCError('TOO_MANY_REQUESTS', {
          message: `Rate limited. Retry after ${retryAfterMs}ms`,
        })

      const email = input.email.toLowerCase().trim()
      if (!email || !input.password)
        throw new ORPCError('UNAUTHORIZED', { message: 'Invalid email or password' })

      const volunteer = await prisma.volunteer.findFirst({ where: { email, deletedAt: null } })
      if (
        !volunteer ||
        !volunteer.passwordHash ||
        !verifyPassword(input.password, volunteer.passwordHash)
      ) {
        throw new ORPCError('UNAUTHORIZED', { message: 'Invalid email or password' })
      }

      const wasPromoted = await promoteIfEntitled(volunteer)

      const token = await createSession(volunteer.id)

      return {
        token,
        wasPromoted,
        message: wasPromoted
          ? "Login successful - you've been granted admin access!"
          : 'Login successful',
      }
    }),

  signup: publicProcedure.input(SignupSchema).handler(async ({ input, context }) => {
    const { allowed, retryAfterMs } = checkRateLimit(context.request, 'signup', {
      limit: 10,
      windowMs: 60 * 60 * 1000,
    })
    if (!allowed)
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: `Rate limited. Retry after ${retryAfterMs}ms`,
      })

    const email = input.email.toLowerCase().trim()
    const existing = await prisma.volunteer.findFirst({
      where: { email },
      select: { id: true, deletedAt: true },
    })
    if (existing) {
      throw new ORPCError('BAD_REQUEST', {
        message: existing.deletedAt
          ? 'This email was previously registered. Contact us to restore your account.'
          : 'Email already registered',
      })
    }

    const emailHash = createHash('sha256').update(email).digest('hex')
    const anonymisedEmail = await prisma.anonymisedEmail.findUnique({
      where: { emailHash },
      select: { reapplyAllowedAt: true },
    })
    if (anonymisedEmail && !anonymisedEmail.reapplyAllowedAt) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'This email was previously rejected. Contact us if you would like to reapply.',
      })
    }

    const volunteer = await prisma.volunteer.create({
      data: {
        name: input.name,
        email,
        passwordHash: hashPassword(input.password),
        applicationMessage: input.applicationMessage ?? null,
        bio: input.bio ?? null,
        discordHandle: input.discordHandle ?? null,
        signalNumber: input.signalNumber ?? null,
        whatsappNumber: input.whatsappNumber ?? null,
        contactPreference: input.contactPreference ?? null,
        contactNotes: input.contactNotes ?? null,
        availabilityHoursPerWeek: input.availabilityHoursPerWeek ?? null,
        location: input.location ?? null,
        country: input.country ?? null,
        localGroup: input.localGroup ?? null,
        locationConfirmedAt: new Date(),
        otherSkills: input.otherSkills ?? null,
        consentMakeProfileVisibleInDirectory: input.consentMakeProfileVisibleInDirectory ?? true,
        consentContactableByProjectOwners: input.consentContactableByProjectOwners ?? true,
        consentShareContactInfoWithProjectOwner:
          input.consentShareContactInfoWithProjectOwner ?? false,
        cookieConsentAnalytics: input.cookieConsentAnalytics ?? false,
        consentGivenAt: new Date(),
        emailDigest: input.emailDigest ?? 'none',
      },
    })

    for (const skillId of input.skillIds ?? []) {
      await prisma.volunteerSkill.upsert({
        where: { volunteerId_skillId: { volunteerId: volunteer.id, skillId } },
        create: { volunteerId: volunteer.id, skillId },
        update: {},
      })
    }

    const platformSettings = await prisma.platformSettings
      .upsert({ where: { id: 1 }, create: { id: 1, requireApplicationApproval: true }, update: {} })
      .catch(() => ({ requireApplicationApproval: true }))

    // The address is unproven until the link is clicked, so any admin bootstrap or
    // invite for it is granted by verifyEmail, not here.
    const vt = await prisma.emailVerificationToken.create({
      data: {
        volunteerId: volunteer.id,
        token: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
    const emailVerificationToken = vt.token
    if (!platformSettings.requireApplicationApproval) {
      await prisma.volunteer.update({
        where: { id: volunteer.id },
        data: { approvalStatus: ApprovalStatus.approved },
      })
    }
    sendWelcomeAndConfirmEmail({ to: email, token: vt.token, name: input.name }).catch((e) =>
      console.error('[SIGNUP]', e),
    )

    const isApproved = !platformSettings.requireApplicationApproval
    if (!isApproved) {
      // Awaited so an approval that follows at once finds the row to clear.
      await notifyAdmins(
        'new_volunteer_signup',
        'New volunteer application',
        `${volunteer.name} has applied to join Catalyse`,
        `/admin/applications/${volunteer.id}`,
        {
          message: html`<strong>${volunteer.name}</strong> (${email}) has applied to join Catalyse.
            Please review their application.`,
          ctaLabel: 'Review Application',
          ctaUrl: `/admin/applications/${volunteer.id}`,
        },
        volunteer.id,
      ).catch((e) => console.error('[SIGNUP NOTIFY]', e))
    }

    const token = await createSession(volunteer.id)
    return {
      id: volunteer.id,
      token,
      pending: !isApproved,
      ...(env.STUB_EMAIL ? { emailVerificationToken } : {}),
    }
  }),

  logout: authedProcedure.handler(async ({ context }) => {
    if (context.token) await deleteSession(context.token)
    return { message: 'Logged out' }
  }),

  logoutOtherSessions: authedProcedure.handler(async ({ context }) => {
    if (!context.token) throw new ORPCError('UNAUTHORIZED')
    await deleteOtherSessions(context.volunteer.id, context.token)
    return { message: 'Signed out of all other sessions' }
  }),

  me: authedProcedure.handler(async ({ context }) => {
    const vol = await prisma.volunteer.findUnique({
      where: { id: context.volunteer.id },
      include: {
        skills: {
          include: { skill: { include: { category: true } } },
          orderBy: [{ skill: { category: { sortOrder: 'asc' } } }, { skill: { sortOrder: 'asc' } }],
        },
        skillEndorsementsReceived: { include: { skill: true } },
      },
    })
    if (!vol) throw new ORPCError('NOT_FOUND')
    return redactVolunteer(vol, {
      showContact: true,
      skills: vol.skills.map((vs) => ({
        id: vs.skill.id,
        categoryId: vs.skill.categoryId,
        name: vs.skill.name,
        description: vs.skill.description,
        sortOrder: vs.skill.sortOrder,
        createdAt: vs.skill.createdAt,
        categoryName: vs.skill.category.name,
        proficiencyLevel: vs.proficiencyLevel,
      })),
      endorsements: vol.skillEndorsementsReceived.map((se) => ({
        skillId: se.skillId,
        rating: se.rating,
        skillName: se.skill.name,
      })),
    })
  }),

  changePassword: authedProcedure
    .input(ChangePasswordSchema)
    .handler(async ({ input, context }) => {
      const { allowed, retryAfterMs } = checkRateLimit(context.request, 'change-password', {
        limit: 10,
        windowMs: 15 * 60 * 1000,
      })
      if (!allowed)
        throw new ORPCError('TOO_MANY_REQUESTS', {
          message: `Rate limited. Retry after ${retryAfterMs}ms`,
        })

      const vol = await prisma.volunteer.findUnique({
        where: { id: context.volunteer.id },
        select: { passwordHash: true },
      })
      if (!vol?.passwordHash || !verifyPassword(input.currentPassword, vol.passwordHash)) {
        throw new ORPCError('BAD_REQUEST', { message: 'Current password is incorrect' })
      }
      // A password change must invalidate every session opened with the old password —
      // not just this one. Drop them all, then issue a fresh one so the caller stays
      // signed in.
      await prisma.volunteer.update({
        where: { id: context.volunteer.id },
        data: {
          passwordHash: hashPassword(input.newPassword),
          updatedAt: new Date(),
        },
      })
      await deleteAllSessions(context.volunteer.id)
      const token = await createSession(context.volunteer.id)
      return { message: 'Password changed successfully', token }
    }),

  changeEmail: authedProcedure.input(ChangeEmailSchema).handler(async ({ input, context }) => {
    // The password check below is a guessing oracle for anyone holding a stolen session.
    const { allowed, retryAfterMs } = checkRateLimit(context.request, 'change-email', {
      limit: 10,
      windowMs: 15 * 60 * 1000,
    })
    if (!allowed)
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: `Rate limited. Retry after ${retryAfterMs}ms`,
      })
    const vol = await prisma.volunteer.findUnique({
      where: { id: context.volunteer.id },
      select: { passwordHash: true },
    })
    if (!vol?.passwordHash)
      throw new ORPCError('BAD_REQUEST', {
        message: 'Cannot change email for accounts without a password. Contact an admin.',
      })
    if (!verifyPassword(input.password, vol.passwordHash))
      throw new ORPCError('BAD_REQUEST', { message: 'Password is incorrect' })
    const newEmail = input.newEmail.toLowerCase().trim()
    const existing = await prisma.volunteer.findFirst({
      where: { email: newEmail, id: { not: context.volunteer.id } },
      select: { id: true },
    })
    if (existing)
      throw new ORPCError('BAD_REQUEST', {
        message: 'This email is already registered to another account',
      })
    if (!(await claimEmailChange(context.volunteer.id))) {
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: `You can change your email ${EMAIL_CHANGES_PER_DAY} times a day. Try again tomorrow.`,
      })
    }
    // The new address is unproven: drop confirmed status and send a fresh confirmation
    // link there, otherwise a verified account could point itself at any address.
    await prisma.emailVerificationToken.updateMany({
      where: { volunteerId: context.volunteer.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    const vt = await prisma.emailVerificationToken.create({
      data: {
        volunteerId: context.volunteer.id,
        token: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
    await prisma.volunteer.update({
      where: { id: context.volunteer.id },
      data: { email: newEmail, emailConfirmed: false, updatedAt: new Date() },
    })
    sendWelcomeAndConfirmEmail({
      to: newEmail,
      token: vt.token,
      name: context.volunteer.name,
    }).catch((e) => console.error('[CHANGE_EMAIL]', e))

    return {
      message: 'Email changed. Check your new address for a confirmation link.',
      ...(env.STUB_EMAIL ? { emailVerificationToken: vt.token } : {}),
    }
  }),

  forgotPassword: publicProcedure
    .input(z.object({ email: z.string() }))
    .handler(async ({ input, context }) => {
      const { allowed, retryAfterMs } = checkRateLimit(context.request, 'forgot-password', {
        limit: 5,
        windowMs: 15 * 60 * 1000,
      })
      if (!allowed)
        throw new ORPCError('TOO_MANY_REQUESTS', {
          message: `Rate limited. Retry after ${retryAfterMs}ms`,
        })

      const successMsg = "If an account exists with this email, you'll receive a reset link."
      const email = input.email.toLowerCase().trim()
      const volunteer = await prisma.volunteer.findFirst({
        where: { email, deletedAt: null },
        select: { id: true, name: true, email: true },
      })
      if (!volunteer?.email) return { message: successMsg }

      const resetToken = generateAuthToken()
      await prisma.passwordResetToken.updateMany({
        where: { volunteerId: volunteer.id, usedAt: null },
        data: { usedAt: new Date() },
      })
      await prisma.passwordResetToken.create({
        data: {
          volunteerId: volunteer.id,
          token: resetToken,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      })
      await sendPasswordResetEmail({ to: volunteer.email, resetToken, name: volunteer.name })

      return {
        message: successMsg,
        ...(env.STUB_EMAIL
          ? { _devResetToken: resetToken, _devResetUrl: `/reset-password?token=${resetToken}` }
          : {}),
      }
    }),

  resetPassword: publicProcedure.input(ResetPasswordSchema).handler(async ({ input, context }) => {
    const { allowed, retryAfterMs } = checkRateLimit(context.request, 'reset-password', {
      limit: 10,
      windowMs: 15 * 60 * 1000,
    })
    if (!allowed)
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: `Rate limited. Retry after ${retryAfterMs}ms`,
      })

    const tokenRecord = await prisma.passwordResetToken.findFirst({
      where: {
        token: input.token,
        usedAt: null,
        expiresAt: { gt: new Date() },
        volunteer: { deletedAt: null },
      },
      select: { id: true, volunteerId: true },
    })
    if (!tokenRecord)
      throw new ORPCError('BAD_REQUEST', { message: 'Invalid or expired reset token' })
    await prisma.volunteer.update({
      where: { id: tokenRecord.volunteerId },
      data: {
        passwordHash: hashPassword(input.newPassword),
        updatedAt: new Date(),
      },
    })
    await deleteAllSessions(tokenRecord.volunteerId)
    await prisma.passwordResetToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    })
    return { message: 'Password reset successful. Please log in with your new password.' }
  }),

  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .handler(async ({ input, context }) => {
      const record = await prisma.emailVerificationToken.findUnique({
        where: { token: input.token },
        include: {
          volunteer: {
            select: {
              id: true,
              name: true,
              email: true,
              emailConfirmed: true,
              approvalStatus: true,
            },
          },
        },
      })
      if (!record)
        throw new ORPCError('BAD_REQUEST', { message: 'Invalid or expired confirmation link' })
      if (record.usedAt)
        throw new ORPCError('BAD_REQUEST', {
          message: 'This confirmation link has already been used',
        })
      if (record.expiresAt < new Date())
        throw new ORPCError('BAD_REQUEST', { message: 'This confirmation link has expired' })

      // Claim the token and confirm in one transaction, and only if the token is still
      // unused: changeEmail voids tokens before switching the address, so a link
      // verified concurrently with an address change never confirms the new address.
      const { volunteer } = record
      const confirmed = await prisma.$transaction(async (tx) => {
        const claimed = await tx.emailVerificationToken.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: new Date() },
        })
        if (claimed.count === 0) return null
        return tx.volunteer.update({
          where: { id: volunteer.id },
          data: { emailConfirmed: true },
          select: { id: true, email: true, emailConfirmed: true },
        })
      })
      if (!confirmed)
        throw new ORPCError('BAD_REQUEST', {
          message: 'This confirmation link has already been used',
        })
      // A click made while signed in to the account comes from whoever set it up. Any
      // other click proves the mailbox only, so it must not hand admin to a password
      // or session somebody else created.
      const requiresPasswordReset =
        context.volunteer?.id !== confirmed.id && (await isEntitledToAdmin(confirmed))
      if (requiresPasswordReset) await revokeCredentials(confirmed.id)
      const wasPromoted = await promoteIfEntitled(confirmed)

      if (!volunteer.emailConfirmed && volunteer.email) {
        if (wasPromoted) {
          sendWelcomeEmail({ to: volunteer.email, name: volunteer.name }).catch((e) =>
            console.error('[VERIFY_EMAIL]', e),
          )
        } else if (volunteer.approvalStatus === ApprovalStatus.approved) {
          const settings = await prisma.platformSettings
            .upsert({
              where: { id: 1 },
              create: { id: 1, requireApplicationApproval: true },
              update: {},
            })
            .catch(() => ({ requireApplicationApproval: true }))
          if (settings.requireApplicationApproval) {
            sendApplicationApprovedEmail({ to: volunteer.email, name: volunteer.name }).catch((e) =>
              console.error('[VERIFY_EMAIL]', e),
            )
          } else {
            sendWelcomeEmail({ to: volunteer.email, name: volunteer.name }).catch((e) =>
              console.error('[VERIFY_EMAIL]', e),
            )
          }
        } else if (volunteer.approvalStatus === ApprovalStatus.pending) {
          sendApplicationReceivedEmail({ to: volunteer.email, name: volunteer.name }).catch((e) =>
            console.error('[VERIFY_EMAIL]', e),
          )
        }
      }
      return { success: true, requiresPasswordReset }
    }),

  resendVerification: publicProcedure
    .input(z.object({ email: z.string().optional() }))
    .handler(async ({ input, context }) => {
      const { allowed, retryAfterMs } = checkRateLimit(context.request, 'resend-verification', {
        limit: 5,
        windowMs: 15 * 60 * 1000,
      })
      if (!allowed)
        throw new ORPCError('TOO_MANY_REQUESTS', {
          message: `Rate limited. Retry after ${retryAfterMs}ms`,
        })

      const okMsg = 'If that email is registered and unconfirmed, a new link has been sent.'
      const email = (input.email ?? context.volunteer?.email ?? '').toLowerCase().trim()
      if (!email) return { message: okMsg }

      const volunteer = await prisma.volunteer.findFirst({
        where: { email, emailConfirmed: false, deletedAt: null },
        select: { id: true, name: true, email: true },
      })
      if (!volunteer?.email) return { message: okMsg }

      await prisma.emailVerificationToken.updateMany({
        where: { volunteerId: volunteer.id, usedAt: null },
        data: { usedAt: new Date() },
      })
      const vt = await prisma.emailVerificationToken.create({
        data: {
          volunteerId: volunteer.id,
          token: randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })
      sendWelcomeAndConfirmEmail({
        to: volunteer.email,
        token: vt.token,
        name: volunteer.name,
      }).catch((e) => console.error('[RESEND_VERIFICATION]', e))

      return { message: okMsg, ...(env.STUB_EMAIL ? { emailVerificationToken: vt.token } : {}) }
    }),

  deleteAccount: authedProcedure
    .input(z.object({ password: z.string().optional() }))
    .handler(async ({ input, context }) => {
      const vol = await prisma.volunteer.findUnique({
        where: { id: context.volunteer.id },
        select: { passwordHash: true },
      })
      if (
        vol?.passwordHash &&
        (!input.password || !verifyPassword(input.password, vol.passwordHash))
      ) {
        throw new ORPCError('BAD_REQUEST', { message: 'Password is incorrect' })
      }
      await prisma.deletionRequest.create({
        data: {
          volunteerId: context.volunteer.id,
          volunteerEmail: context.volunteer.email,
          status: 'completed',
        },
      })
      await sendAccountDeletionNotifications(context.volunteer.id, context.volunteer.name)
      await deleteAllSessions(context.volunteer.id)
      await prisma.volunteer.update({
        where: { id: context.volunteer.id },
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
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      await prisma.volunteerSkill.deleteMany({ where: { volunteerId: context.volunteer.id } })
      return { message: "Your account has been deleted. We're sorry to see you go." }
    }),

  google: publicProcedure
    .input(
      z.object({
        credential: z.string().optional(),
        stub: z.boolean().optional(),
        email: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const { allowed, retryAfterMs } = checkRateLimit(context.request, 'google', {
        limit: 20,
        windowMs: 5 * 60 * 1000,
      })
      if (!allowed)
        throw new ORPCError('TOO_MANY_REQUESTS', {
          message: `Rate limited. Retry after ${retryAfterMs}ms`,
        })
      if (!env.GOOGLE_CLIENT_ID && !stubGoogle())
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'Google Sign-In is not configured',
        })

      let email: string
      let name: string
      if (stubGoogle() && input.stub) {
        email = input.email ?? 'stub@example.com'
        name = input.name ?? 'Stub User'
      } else {
        const googleUser = await verifyGoogleToken(input.credential ?? '')
        if (!googleUser) throw new ORPCError('UNAUTHORIZED', { message: 'Invalid Google token' })
        ;({ email, name } = googleUser)
      }

      const found = await prisma.volunteer.findFirst({ where: { email, deletedAt: null } })
      if (found) {
        // Google vouches for the address, which may have been unconfirmed since a
        // password signup. That signup need not have been this person's.
        if (!found.emailConfirmed) await revokeCredentials(found.id)
        const existing = found.emailConfirmed
          ? found
          : await prisma.volunteer.update({
              where: { id: found.id },
              data: { emailConfirmed: true },
            })
        const token = await createSession(existing.id)
        const wasPromoted = await promoteIfEntitled(existing)
        return {
          token,
          wasPromoted,
          isNewUser: false,
          isPending: false,
          name: existing.name,
          email,
        }
      }

      // Don't create a volunteer row yet — the applicant still needs to fill in the
      // required application fields (bio, country, availability, application message).
      // The row is created by completeGoogleSignup once that form is submitted, so an
      // abandoned Google auth never leaves a blank ghost application in the admin queue.
      return {
        token: null,
        wasPromoted: false,
        isNewUser: true,
        isPending: true,
        name,
        email,
      }
    }),

  completeGoogleSignup: publicProcedure
    .input(CompleteGoogleSignupSchema)
    .handler(async ({ input, context }) => {
      const { allowed, retryAfterMs } = checkRateLimit(context.request, 'signup', {
        limit: 10,
        windowMs: 60 * 60 * 1000,
      })
      if (!allowed)
        throw new ORPCError('TOO_MANY_REQUESTS', {
          message: `Rate limited. Retry after ${retryAfterMs}ms`,
        })
      if (!env.GOOGLE_CLIENT_ID && !stubGoogle())
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'Google Sign-In is not configured',
        })

      let email: string
      let name: string
      if (stubGoogle() && input.stub) {
        email = 'stub@example.com'
        name = 'Stub User'
      } else {
        const googleUser = await verifyGoogleToken(input.credential ?? '')
        if (!googleUser)
          throw new ORPCError('UNAUTHORIZED', {
            message: 'Your Google sign-in has expired, please sign in with Google again',
          })
        email = googleUser.email
        name = sanitisePersonName(googleUser.name)
      }

      const existing = await prisma.volunteer.findFirst({
        where: { email },
        select: { id: true, deletedAt: true },
      })
      if (existing) {
        throw new ORPCError('BAD_REQUEST', {
          message: existing.deletedAt
            ? 'This email was previously registered. Contact us to restore your account.'
            : 'Email already registered',
        })
      }

      const volunteer = await prisma.volunteer.create({
        data: {
          name,
          email,
          emailConfirmed: true,
          applicationMessage: input.applicationMessage,
          bio: input.bio,
          discordHandle: input.discordHandle ?? null,
          signalNumber: input.signalNumber ?? null,
          whatsappNumber: input.whatsappNumber ?? null,
          contactPreference: input.contactPreference ?? null,
          contactNotes: input.contactNotes ?? null,
          availabilityHoursPerWeek: input.availabilityHoursPerWeek,
          location: input.location ?? null,
          country: input.country,
          localGroup: input.localGroup ?? null,
          locationConfirmedAt: new Date(),
          otherSkills: input.otherSkills ?? null,
          consentMakeProfileVisibleInDirectory: input.consentMakeProfileVisibleInDirectory ?? true,
          consentContactableByProjectOwners: input.consentContactableByProjectOwners ?? true,
          consentShareContactInfoWithProjectOwner:
            input.consentShareContactInfoWithProjectOwner ?? false,
          cookieConsentAnalytics: input.cookieConsentAnalytics ?? false,
          consentGivenAt: new Date(),
          emailDigest: input.emailDigest ?? 'none',
        },
      })

      for (const skillId of input.skillIds ?? []) {
        await prisma.volunteerSkill.upsert({
          where: { volunteerId_skillId: { volunteerId: volunteer.id, skillId } },
          create: { volunteerId: volunteer.id, skillId },
          update: {},
        })
      }

      const wasPromoted = await promoteIfEntitled(volunteer).catch(() => false)
      const isApproved = wasPromoted

      if (isApproved) {
        sendWelcomeEmail({ to: email, name }).catch((e) => console.error('[GOOGLE_SIGNUP]', e))
      } else {
        sendApplicationReceivedEmail({ to: email, name }).catch((e) =>
          console.error('[GOOGLE_SIGNUP]', e),
        )
      }
      const token = await createSession(volunteer.id)
      return {
        token,
        wasPromoted,
        pending: !isApproved,
        name,
      }
    }),

  googleClientId: publicProcedure.handler(() => ({
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    stub: stubGoogle(),
  })),
}
