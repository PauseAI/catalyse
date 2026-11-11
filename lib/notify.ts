import { prisma } from './prisma'
import { sendProjectNotificationEmail, sendAdminAlertEmail, html } from './email'
import { resolveDelivery, type Delivery } from './notification-types'
import { chapterCarers, globalAdminWhere } from './chapter-access-server'
import { logger } from './logger'

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
    .catch((e) => logger.error(e, '[NOTIFY CLEAR ERROR]'))
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

/**
 * The email a caller writes for a notification: a project notice, an alert with one button, or
 * its own template sent by `send`. Without one, an emailed notification is its title, body and
 * link.
 */
export type NotifyEmailPayload =
  | {
      subject?: string
      message: string
      projectId: number
      projectTitle: string
      extraHtml?: string
    }
  | { subject?: string; message: string; ctaLabel: string; ctaUrl: string }
  | { send: (to: string, name: string) => Promise<boolean> }

function sendNotificationEmail(
  to: string,
  name: string,
  title: string,
  body: string | null | undefined,
  link: string | null | undefined,
  email: NotifyEmailPayload | undefined,
): Promise<boolean> {
  if (email && 'send' in email) return email.send(to, name)
  if (email && 'projectId' in email) {
    return sendProjectNotificationEmail({
      to,
      name,
      subject: email.subject ?? title,
      message: email.message,
      projectTitle: email.projectTitle,
      projectId: email.projectId,
      extraHtml: email.extraHtml,
    })
  }
  return sendAdminAlertEmail({
    to,
    name,
    subject: email?.subject ?? title,
    message: email?.message ?? html`${body ?? title}`,
    ctaLabel: email?.ctaLabel ?? 'Open in Catalyse',
    ctaUrl: email?.ctaUrl ?? link ?? '/inbox',
  })
}

type NotificationItem = {
  title: string
  body?: string | null
  link?: string | null
  entityId?: number | null
}

/**
 * The one place a notification is delivered: it always lands in the Inbox, and the recipient's
 * choice for its type (lib/notification-types.ts) decides whether it is also emailed now, held
 * for their daily digest, or neither.
 */
export async function notifyUser(
  volunteerId: number,
  type: string,
  title: string,
  body: string | null | undefined,
  link: string | null | undefined,
  email?: NotifyEmailPayload,
  entityId?: number | null,
): Promise<void> {
  await notifyUserOfEach(volunteerId, type, [{ title, body, link, entityId }], email)
}

/**
 * Several notifications of one type to one person, delivered as `notifyUser` does but emailed
 * together: one Inbox row each, and at most one email, written by `email` or else from the first.
 */
export async function notifyUserOfEach(
  volunteerId: number,
  type: string,
  items: NotificationItem[],
  email?: NotifyEmailPayload,
): Promise<void> {
  // The rows are awaited so a caller can rely on them being there when this resolves; only the
  // email is left to run on its own. Nothing here throws: the caller's change is already saved.
  // One round trip for the person and their choice for this type, as every notification pays it.
  const vol = await prisma.$queryRaw<
    { name: string; email: string | null; technical: boolean; delivery: Delivery | null }[]
  >`
    SELECT v.name, v.email, coalesce(v.is_technical_admin, false) AS technical, p.delivery::text AS delivery
    FROM volunteers v
    LEFT JOIN notification_preferences p ON p.volunteer_id = v.id AND p.type = ${type}
    WHERE v.id = ${volunteerId} AND v.deleted_at IS NULL
  `
    .then((rows) => rows[0] ?? null)
    .catch((e) => {
      logger.error(e, '[EMAIL ERROR]')
      return null
    })
  const delivery = vol
    ? resolveDelivery(type, { isTechnicalAdmin: vol.technical }, vol.delivery ?? undefined, !!email)
    : 'in_app'
  const emailTo = vol?.email ? vol.email : null

  const ids: number[] = []
  for (const item of items) {
    const row = await prisma.notification
      .create({
        data: {
          volunteerId,
          type,
          title: item.title,
          body: item.body ?? null,
          link: item.link ?? null,
          entityId: item.entityId ?? null,
          inDigest: delivery === 'digest' && !!emailTo,
        },
      })
      .catch((e) => {
        logger.error(e, '[NOTIFY ERROR]')
        return null
      })
    if (row) ids.push(row.id)
  }
  if (delivery !== 'email' || !vol || !emailTo) return

  const [first] = items
  sendNotificationEmail(emailTo, vol.name, first.title, first.body, first.link, email)
    .then(async (sent) => {
      if (sent) {
        await prisma.notification.updateMany({
          where: { id: { in: ids } },
          data: { emailedAt: new Date() },
        })
      }
    })
    .catch((e) => logger.error(e, '[EMAIL ERROR]'))
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
    where: globalAdminWhere(),
    select: { id: true },
  })
  await Promise.all(
    admins.map((admin) => notifyUser(admin.id, type, title, body, link, email, entityId)),
  )
}

/**
 * Alerts the lead and deputies of `chapterId` about something of theirs to act on. The holding
 * pool, and a chapter with no staff, are looked after by the global admins, so they get it.
 */
export async function notifyChapterStaff(
  chapterId: number | null,
  type: string,
  title: string,
  body: string | null | undefined,
  link: string | null | undefined,
  email?: NotifyEmailPayload,
  entityId?: number | null,
): Promise<void> {
  const recipients = await chapterCarers(chapterId)
  await Promise.all(
    recipients.map((id) => notifyUser(id, type, title, body, link, email, entityId)),
  )
}
