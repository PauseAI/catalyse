import { prisma } from './prisma'
import { sendProjectNotificationEmail, sendAdminAlertEmail } from './email'
import { categoryOf } from './notification-categories'

export async function createNotification(
  volunteerId: number,
  type: string,
  title: string,
  body?: string | null,
  link?: string | null,
  entityId?: number | null,
) {
  return prisma.notification.create({
    data: {
      volunteerId,
      type,
      title,
      body: body ?? null,
      link: link ?? null,
      entityId: entityId ?? null,
    },
  })
}

// Removes every recipient's copy of a notification once the thing it's about has been
// resolved by someone — e.g. a project proposal is approved, so the other admins no longer
// need "new project proposal" in their list.
export async function clearNotifications(type: string, entityId: number): Promise<void> {
  await prisma.notification
    .deleteMany({ where: { type, entityId } })
    .catch((e) => console.error('[NOTIFY CLEAR ERROR]', e))
}

/**
 * One notification per person, type and thing, refreshed in place: the old copy goes and a new
 * unread one takes its place, so a daily reminder is one row that comes back to the top rather
 * than a new row every day.
 */
export async function refreshNotification(
  volunteerId: number,
  type: string,
  title: string,
  body: string | null,
  link: string,
  entityId: number,
): Promise<void> {
  await prisma.notification.deleteMany({ where: { volunteerId, type, entityId } })
  await createNotification(volunteerId, type, title, body, link, entityId)
}

type NotifyEmailPayload =
  | {
      subject?: string
      message: string
      projectId: number
      projectTitle: string
      extraHtml?: string
    }
  | { subject?: string; message: string; ctaLabel: string; ctaUrl: string }

export async function notifyUser(
  volunteerId: number,
  type: string,
  title: string,
  body: string | null | undefined,
  link: string | null | undefined,
  email?: NotifyEmailPayload,
  entityId?: number | null,
): Promise<void> {
  const created = createNotification(volunteerId, type, title, body, link, entityId).catch((e) => {
    console.error('[NOTIFY ERROR]', e)
    return null
  })
  if (!email) return

  const vol = await prisma.volunteer.findFirst({
    where: { id: volunteerId, deletedAt: null },
    select: { name: true, email: true, emailMutedCategories: true },
  })
  if (!vol?.email) return
  if (vol.emailMutedCategories.includes(categoryOf(type))) return

  const send =
    'projectId' in email
      ? sendProjectNotificationEmail({
          to: vol.email,
          name: vol.name,
          subject: email.subject ?? title,
          message: email.message,
          projectTitle: email.projectTitle,
          projectId: email.projectId,
          extraHtml: email.extraHtml,
        })
      : sendAdminAlertEmail({
          to: vol.email,
          name: vol.name,
          subject: email.subject ?? title,
          message: email.message,
          ctaLabel: email.ctaLabel,
          ctaUrl: email.ctaUrl,
        })

  send
    .then(async () => {
      const notification = await created
      if (notification) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: { emailedAt: new Date() },
        })
      }
    })
    .catch((e) => console.error('[EMAIL ERROR]', e))
}

/** Alerts every member of a team that a project has been tagged to them and gone live. */
export async function notifyTeamOfProject(
  teamId: number,
  projectId: number,
  projectTitle: string,
): Promise<void> {
  const members = await prisma.teamMembership.findMany({
    where: { teamId },
    select: { volunteerId: true },
  })
  await Promise.all(
    members.map((m) =>
      notifyUser(
        m.volunteerId,
        'team_project_assigned',
        `New project for your team: ${projectTitle}`,
        null,
        `/projects/${projectId}`,
        undefined,
        projectId,
      ),
    ),
  )
}

export async function notifyAdmins(
  type: string,
  title: string,
  body: string | null | undefined,
  link: string | null | undefined,
  email?: NotifyEmailPayload,
  entityId?: number | null,
): Promise<void> {
  const admins = await prisma.volunteer.findMany({
    where: { isAdmin: true, deletedAt: null },
    select: { id: true },
  })
  await Promise.all(
    admins.map((admin) => notifyUser(admin.id, type, title, body, link, email, entityId)),
  )
}
