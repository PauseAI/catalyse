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

export type NotificationItem = {
  title: string
  body?: string | null
  link?: string | null
  entityId?: number | null
}

/**
 * The one place a notification is delivered: it always lands in the Inbox, and the recipient's
 * choice for its type (lib/notification-types.ts) decides whether it is also emailed now, held
 * for their digest, or neither.
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
export type Route = {
  delivery: Delivery
  /** Who an email would go to; null for someone gone or without an address. */
  to: { name: string; email: string } | null
}

/**
 * How a notification of `type` reaches `volunteerId`, in one round trip for the person and
 * their choice. Null when the lookup itself fails, so the caller can decide what that means.
 */
export async function routeFor(
  volunteerId: number,
  type: string,
  hasEmail: boolean,
): Promise<Route | null> {
  return prisma.$queryRaw<
    { name: string; email: string | null; technical: boolean; delivery: Delivery | null }[]
  >`
    SELECT v.name, v.email, coalesce(v.is_technical_admin, false) AS technical, p.delivery::text AS delivery
    FROM volunteers v
    LEFT JOIN notification_preferences p ON p.volunteer_id = v.id AND p.type = ${type}
    WHERE v.id = ${volunteerId} AND v.deleted_at IS NULL
  `
    .then(([vol]): Route => {
      if (!vol) return { delivery: 'in_app', to: null }
      return {
        delivery: resolveDelivery(
          type,
          { isTechnicalAdmin: vol.technical },
          vol.delivery ?? undefined,
          hasEmail,
        ),
        to: vol.email ? { name: vol.name, email: vol.email } : null,
      }
    })
    .catch((e) => {
      logger.error(e, '[EMAIL ERROR]')
      return null
    })
}

/** Whether rows for `route` are held for the digest. */
export const heldForDigest = (route: Route) => route.delivery === 'digest' && route.to !== null

/**
 * Emails notifications `ids` on their own (nothing awaits it) when `route` says to, and
 * records when they were emailed.
 */
export function emailIfChosen(
  route: Route,
  ids: number[],
  item: NotificationItem,
  email: NotifyEmailPayload | undefined,
): void {
  if (route.delivery !== 'email' || !route.to) return
  sendNotificationEmail(route.to.email, route.to.name, item.title, item.body, item.link, email)
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

export async function notifyUserOfEach(
  volunteerId: number,
  type: string,
  items: NotificationItem[],
  email?: NotifyEmailPayload,
): Promise<void> {
  // The rows are awaited so a caller can rely on them being there when this resolves; only the
  // email is left to run on its own. Nothing here throws: the caller's change is already saved.
  const route = (await routeFor(volunteerId, type, !!email)) ?? { delivery: 'in_app', to: null }
  const rows = await prisma.notification
    .createManyAndReturn({
      data: items.map((item) => ({
        volunteerId,
        type,
        title: item.title,
        body: item.body ?? null,
        link: item.link ?? null,
        entityId: item.entityId ?? null,
        inDigest: heldForDigest(route),
      })),
      select: { id: true },
    })
    .catch((e) => {
      logger.error(e, '[NOTIFY ERROR]')
      return []
    })
  emailIfChosen(
    route,
    rows.map((r) => r.id),
    items[0],
    email,
  )
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
