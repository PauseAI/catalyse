import { render } from '@react-email/components'
import { env } from './env'
import { emailTransport } from './email-transport'
import { WelcomeAndConfirmEmail } from './emails/WelcomeAndConfirmEmail'
import { ApplicationReceivedEmail } from './emails/ApplicationReceivedEmail'
import { ApplicationApprovedEmail } from './emails/ApplicationApprovedEmail'
import { ApplicationRejectedEmail } from './emails/ApplicationRejectedEmail'
import { ApplicationNeedsInfoEmail } from './emails/ApplicationNeedsInfoEmail'
import { ApplicationReopenedEmail } from './emails/ApplicationReopenedEmail'
import { PendingApplicationsSummaryEmail } from './emails/PendingApplicationsSummaryEmail'
import { PasswordResetEmail } from './emails/PasswordResetEmail'
import { AccountMergeEmail } from './emails/AccountMergeEmail'
import { OutreachLoginEmail } from './emails/OutreachLoginEmail'
import { AdminInviteEmail, type ChapterRoleInvite, roleTitle } from './emails/AdminInviteEmail'
import { WelcomeEmail } from './emails/WelcomeEmail'
import { ProjectNotificationEmail } from './emails/ProjectNotificationEmail'
import { AdminAlertEmail } from './emails/AdminAlertEmail'
import { LocalGroupSuggestionEmail } from './emails/LocalGroupSuggestionEmail'
import { RelayMessageEmail } from './emails/RelayMessageEmail'
import { DigestEmail, type DigestProject } from './emails/DigestEmail'
import { TaskNudgeEmail } from './emails/TaskNudgeEmail'
import { TaskFinalWarningEmail } from './emails/TaskFinalWarningEmail'
import { TaskSurrenderedOwnerEmail } from './emails/TaskSurrenderedOwnerEmail'
import { TaskSurrenderedAssigneeEmail } from './emails/TaskSurrenderedAssigneeEmail'
import { DailySummaryEmail, type SummaryEmailSection } from './emails/DailySummaryEmail'

export type { ChapterRoleInvite, DigestProject, SummaryEmailSection }

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Marks a string as already-safe HTML so `html` won't escape it again — for fragments
 * this module (or a caller) has itself built out of escaped pieces.
 */
class SafeHtml {
  constructor(readonly value: string) {}
}

export function rawHtml(value: string): SafeHtml {
  return new SafeHtml(value)
}

/**
 * Tagged template for the HTML bodies passed to notifyUser/notifyAdmins as `message`
 * and `extraHtml`. Every interpolated value is escaped, so volunteer names, project
 * titles and free-text messages can't inject markup into an email we send. Wrap a
 * deliberate fragment in `rawHtml()` to opt out.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0]
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    out += v instanceof SafeHtml ? v.value : escapeHtml(String(v ?? ''))
    out += strings[i + 1]
  }
  return out
}

export function isEmailConfigured(): boolean {
  return emailTransport().configured()
}

function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
  return emailTransport().send({ to, subject, html, replyTo })
}

export function buildWelcomeAndConfirmHtml(name: string, confirmUrl: string): Promise<string> {
  return render(<WelcomeAndConfirmEmail name={name} confirmUrl={confirmUrl} appUrl={env.APP_URL} />)
}

export async function sendWelcomeAndConfirmEmail({
  to,
  token,
  name,
}: {
  to: string
  token: string
  name: string
}): Promise<boolean> {
  const confirmUrl = `${env.APP_URL}/verify-email?token=${token}`
  return sendEmail(
    to,
    'Welcome to Catalyse: please confirm your email',
    await buildWelcomeAndConfirmHtml(name, confirmUrl),
  )
}

export function buildApplicationReceivedHtml(name: string): Promise<string> {
  return render(<ApplicationReceivedEmail name={name} appUrl={env.APP_URL} />)
}

export async function sendApplicationReceivedEmail({
  to,
  name,
}: {
  to: string
  name: string
}): Promise<boolean> {
  return sendEmail(
    to,
    'Your Catalyse application has been received',
    await buildApplicationReceivedHtml(name),
  )
}

export function buildApplicationApprovedHtml(name: string, appUrl: string): Promise<string> {
  return render(<ApplicationApprovedEmail name={name} appUrl={appUrl} />)
}

export async function sendApplicationApprovedEmail({
  to,
  name,
}: {
  to: string
  name: string
}): Promise<boolean> {
  return sendEmail(
    to,
    'Your Catalyse application has been approved',
    await buildApplicationApprovedHtml(name, env.APP_URL),
  )
}

export function buildApplicationRejectedHtml(
  name: string,
  applicantNotes?: string,
): Promise<string> {
  return render(
    <ApplicationRejectedEmail name={name} appUrl={env.APP_URL} applicantNotes={applicantNotes} />,
  )
}

export async function sendApplicationRejectedEmail({
  to,
  name,
  applicantNotes,
}: {
  to: string
  name: string
  applicantNotes?: string
}): Promise<boolean> {
  return sendEmail(
    to,
    'Update on your Catalyse application',
    await buildApplicationRejectedHtml(name, applicantNotes),
  )
}

export function buildApplicationNeedsInfoHtml(
  name: string,
  loginUrl: string,
  applicantNotes?: string,
): Promise<string> {
  return render(
    <ApplicationNeedsInfoEmail
      name={name}
      loginUrl={loginUrl}
      appUrl={env.APP_URL}
      applicantNotes={applicantNotes}
    />,
  )
}

export async function sendApplicationNeedsInfoEmail({
  to,
  name,
  applicantNotes,
}: {
  to: string
  name: string
  applicantNotes?: string
}): Promise<boolean> {
  const loginUrl = `${env.APP_URL}/login?email=${encodeURIComponent(to)}`
  return sendEmail(
    to,
    'Action needed on your Catalyse application',
    await buildApplicationNeedsInfoHtml(name, loginUrl, applicantNotes),
  )
}

export function buildApplicationReopenedHtml(
  name: string,
  loginUrl: string,
  applicantNotes?: string,
): Promise<string> {
  return render(
    <ApplicationReopenedEmail
      name={name}
      loginUrl={loginUrl}
      appUrl={env.APP_URL}
      applicantNotes={applicantNotes}
    />,
  )
}

export async function sendApplicationReopenedEmail({
  to,
  name,
  applicantNotes,
}: {
  to: string
  name: string
  applicantNotes?: string
}): Promise<boolean> {
  const loginUrl = `${env.APP_URL}/login?email=${encodeURIComponent(to)}`
  return sendEmail(
    to,
    'Your Catalyse application has been reopened',
    await buildApplicationReopenedHtml(name, loginUrl, applicantNotes),
  )
}

export function buildPendingApplicationsSummaryHtml(
  count: number,
  appUrl: string,
): Promise<string> {
  return render(<PendingApplicationsSummaryEmail count={count} appUrl={appUrl} />)
}

export async function sendPendingApplicationsSummaryEmail({
  to,
  count,
}: {
  to: string
  name: string
  count: number
}): Promise<boolean> {
  const plural = count === 1 ? 'application' : 'applications'
  return sendEmail(
    to,
    `${count} pending ${plural} on Catalyse`,
    await buildPendingApplicationsSummaryHtml(count, env.APP_URL),
  )
}

export function buildPasswordResetHtml(resetUrl: string, name: string): Promise<string> {
  return render(<PasswordResetEmail resetUrl={resetUrl} name={name} appUrl={env.APP_URL} />)
}

export async function sendPasswordResetEmail({
  to,
  resetToken,
  name = 'there',
}: {
  to: string
  resetToken: string
  name?: string
}): Promise<boolean> {
  const resetUrl = `${env.APP_URL}/reset-password?token=${resetToken}`
  return sendEmail(to, 'Reset your Catalyse password', await buildPasswordResetHtml(resetUrl, name))
}

export const ACCOUNT_MERGE_SUBJECT = 'Confirm merging your Catalyse accounts'

/**
 * Sent to the address of the account being merged in, so a merge happens only once whoever
 * asked for it from the other account also holds this one's mailbox.
 */
export function buildAccountMergeHtml(confirmUrl: string, name: string): Promise<string> {
  return render(<AccountMergeEmail confirmUrl={confirmUrl} name={name} appUrl={env.APP_URL} />)
}

export async function sendAccountMergeEmail({
  to,
  name,
  token,
}: {
  to: string
  name: string
  token: string
}): Promise<boolean> {
  const confirmUrl = `${env.APP_URL}/merge-accounts?token=${token}`
  return sendEmail(to, ACCOUNT_MERGE_SUBJECT, await buildAccountMergeHtml(confirmUrl, name))
}

export function buildOutreachLoginHtml(loginUrl: string): Promise<string> {
  return render(<OutreachLoginEmail loginUrl={loginUrl} appUrl={env.APP_URL} />)
}

export async function sendOutreachLoginEmail({
  to,
  loginToken,
}: {
  to: string
  loginToken: string
}): Promise<boolean> {
  const loginUrl = `${env.APP_URL}/people-for-a-pause-protest-journalist-outreach/verify?token=${loginToken}`
  return sendEmail(
    to,
    'Your People for a Pause outreach link',
    await buildOutreachLoginHtml(loginUrl),
  )
}

export function buildAdminInviteHtml(
  inviteUrl: string,
  invitedBy: string,
  invite: ChapterRoleInvite,
): Promise<string> {
  return render(
    <AdminInviteEmail
      inviteUrl={inviteUrl}
      invitedBy={invitedBy}
      invite={invite}
      appUrl={env.APP_URL}
    />,
  )
}

export function chapterInviteSubject(invitedBy: string, invite: ChapterRoleInvite): string {
  return `${invitedBy} invited you to be ${roleTitle(invite)}`
}

export async function sendAdminInviteEmail({
  to,
  inviteToken,
  invitedBy,
  invite,
}: {
  to: string
  inviteToken: string
  invitedBy: string
  invite: ChapterRoleInvite
}): Promise<boolean> {
  const inviteUrl = `${env.APP_URL}/accept-invite?token=${inviteToken}`
  return sendEmail(
    to,
    chapterInviteSubject(invitedBy, invite),
    await buildAdminInviteHtml(inviteUrl, invitedBy, invite),
  )
}

export function buildWelcomeHtml(name: string, appUrl: string): Promise<string> {
  return render(<WelcomeEmail name={name} appUrl={appUrl} />)
}

export async function sendWelcomeEmail({
  to,
  name,
}: {
  to: string
  name: string
}): Promise<boolean> {
  return sendEmail(to, 'Welcome to Catalyse!', await buildWelcomeHtml(name, env.APP_URL))
}

export function buildProjectNotificationHtml(
  name: string,
  subject: string,
  message: string,
  projectId: number,
  appUrl: string,
  extraHtml = '',
): Promise<string> {
  return render(
    <ProjectNotificationEmail
      name={name}
      subject={subject}
      message={message}
      projectId={projectId}
      appUrl={appUrl}
      extraHtml={extraHtml}
    />,
  )
}

export function buildAdminAlertHtml(
  name: string,
  subject: string,
  message: string,
  ctaLabel: string,
  ctaUrl: string,
): Promise<string> {
  return render(
    <AdminAlertEmail
      name={name}
      subject={subject}
      message={message}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
      appUrl={env.APP_URL}
    />,
  )
}

export async function sendAdminAlertEmail({
  to,
  name,
  subject,
  message,
  ctaLabel,
  ctaUrl,
}: {
  to: string
  name: string
  subject: string
  message: string
  ctaLabel: string
  ctaUrl: string
}): Promise<boolean> {
  const url = ctaUrl.startsWith('http') ? ctaUrl : `${env.APP_URL}${ctaUrl}`
  return sendEmail(to, subject, await buildAdminAlertHtml(name, subject, message, ctaLabel, url))
}

export async function sendProjectNotificationEmail({
  to,
  name,
  subject,
  message,
  projectId,
  extraHtml = '',
}: {
  to: string
  name: string
  subject: string
  message: string
  projectTitle: string
  projectId: number
  extraHtml?: string
}): Promise<boolean> {
  return sendEmail(
    to,
    subject,
    await buildProjectNotificationHtml(name, subject, message, projectId, env.APP_URL, extraHtml),
  )
}

export function buildLocalGroupSuggestionHtml(
  name: string,
  action: string,
  groupName: string,
  adminNotes?: string | null,
): Promise<string> {
  return render(
    <LocalGroupSuggestionEmail
      name={name}
      action={action}
      groupName={groupName}
      appUrl={env.APP_URL}
      adminNotes={adminNotes}
    />,
  )
}

export async function sendLocalGroupSuggestionEmail({
  to,
  name,
  action,
  groupName,
  adminNotes,
}: {
  to: string
  name: string
  action: string
  groupName: string
  adminNotes?: string | null
}): Promise<boolean> {
  const subjects: Record<string, string> = {
    accepted: `Your local group suggestion "${groupName}" was accepted`,
    merge: `Your local group suggestion "${groupName}" has been merged`,
    on_hold: `Your local group suggestion "${groupName}" is under review`,
    declined: `Update on your local group suggestion "${groupName}"`,
  }
  const subject = subjects[action] ?? `Update on your local group suggestion`
  return sendEmail(
    to,
    subject,
    await buildLocalGroupSuggestionHtml(name, action, groupName, adminNotes),
  )
}

/**
 * A message relayed from one volunteer to another. `threadUrl` is where to reply on Catalyse;
 * `repliesByEmail` says whether the sender shared their address as the reply-to.
 */
export function buildRelayMessageHtml(
  toName: string,
  fromName: string,
  subject: string,
  message: string,
  projectTitle: string | undefined,
  threadUrl: string,
  repliesByEmail: boolean,
): Promise<string> {
  return render(
    <RelayMessageEmail
      toName={toName}
      fromName={fromName}
      subject={subject}
      message={message}
      projectTitle={projectTitle}
      threadUrl={threadUrl}
      repliesByEmail={repliesByEmail}
      appUrl={env.APP_URL}
    />,
  )
}

/**
 * Emails a copy of a message. The sender's address is the reply-to only when they chose to
 * share it; otherwise the recipient replies on Catalyse.
 */
export async function sendRelayMessage({
  to,
  toName,
  fromName,
  replyTo,
  subject,
  message,
  projectTitle,
  threadId,
}: {
  to: string
  toName: string
  fromName: string
  replyTo: string | null
  subject: string
  message: string
  projectTitle?: string
  threadId: number
}): Promise<boolean> {
  const html = await buildRelayMessageHtml(
    toName,
    fromName,
    subject,
    message,
    projectTitle,
    `${env.APP_URL}/inbox/messages/${threadId}`,
    replyTo !== null,
  )
  return sendEmail(to, `[Catalyse] ${subject}`, html, replyTo ?? undefined)
}

export function buildDigestHtml(
  name: string,
  appUrl: string,
  projects: DigestProject[],
  isMatch = false,
): Promise<string> {
  return render(<DigestEmail name={name} appUrl={appUrl} projects={projects} isMatch={isMatch} />)
}

export async function sendDigestEmail({
  to,
  name,
  projects,
  isMatch = false,
}: {
  to: string
  name: string
  projects: DigestProject[]
  isMatch?: boolean
}): Promise<boolean> {
  if (!projects.length) return false
  const html = await buildDigestHtml(name, env.APP_URL, projects, isMatch)
  const subject = isMatch ? 'New projects matching your skills' : "What's new on Catalyse"
  return sendEmail(to, subject, html)
}

export function buildTaskNudgeHtml(
  name: string,
  taskTitle: string,
  projectTitle: string,
  projectId: number,
  taskId: number,
  daysInactive: number,
  activityPhrase: string,
  lastActivityDate: string,
): Promise<string> {
  return render(
    <TaskNudgeEmail
      name={name}
      taskTitle={taskTitle}
      projectTitle={projectTitle}
      projectId={projectId}
      taskId={taskId}
      daysInactive={daysInactive}
      activityPhrase={activityPhrase}
      lastActivityDate={lastActivityDate}
      appUrl={env.APP_URL}
    />,
  )
}

export async function sendTaskNudgeEmail({
  to,
  name,
  taskTitle,
  projectTitle,
  projectId,
  taskId,
  daysInactive,
  activityPhrase,
  lastActivityDate,
}: {
  to: string
  name: string
  taskTitle: string
  projectTitle: string
  projectId: number
  taskId: number
  daysInactive: number
  activityPhrase: string
  lastActivityDate: string
}): Promise<boolean> {
  const subject = `How's it going with ${taskTitle}?`
  return sendEmail(
    to,
    subject,
    await buildTaskNudgeHtml(
      name,
      taskTitle,
      projectTitle,
      projectId,
      taskId,
      daysInactive,
      activityPhrase,
      lastActivityDate,
    ),
  )
}

export function buildTaskFinalWarningHtml(
  name: string,
  taskTitle: string,
  projectTitle: string,
  projectId: number,
  taskId: number,
  daysInactive: number,
  activityPhrase: string,
  lastActivityDate: string,
  surrenderDate: string,
): Promise<string> {
  return render(
    <TaskFinalWarningEmail
      name={name}
      taskTitle={taskTitle}
      projectTitle={projectTitle}
      projectId={projectId}
      taskId={taskId}
      daysInactive={daysInactive}
      activityPhrase={activityPhrase}
      lastActivityDate={lastActivityDate}
      surrenderDate={surrenderDate}
      appUrl={env.APP_URL}
    />,
  )
}

export async function sendTaskFinalWarningEmail({
  to,
  name,
  taskTitle,
  projectTitle,
  projectId,
  taskId,
  daysInactive,
  activityPhrase,
  lastActivityDate,
  surrenderDate,
}: {
  to: string
  name: string
  taskTitle: string
  projectTitle: string
  projectId: number
  taskId: number
  daysInactive: number
  activityPhrase: string
  lastActivityDate: string
  surrenderDate: string
}): Promise<boolean> {
  const subject = `A quick nudge about ${taskTitle}`
  return sendEmail(
    to,
    subject,
    await buildTaskFinalWarningHtml(
      name,
      taskTitle,
      projectTitle,
      projectId,
      taskId,
      daysInactive,
      activityPhrase,
      lastActivityDate,
      surrenderDate,
    ),
  )
}

export function buildTaskSurrenderedOwnerHtml(
  ownerName: string,
  volunteerName: string,
  taskTitle: string,
  projectTitle: string,
  projectId: number,
): Promise<string> {
  return render(
    <TaskSurrenderedOwnerEmail
      ownerName={ownerName}
      volunteerName={volunteerName}
      taskTitle={taskTitle}
      projectTitle={projectTitle}
      projectId={projectId}
      appUrl={env.APP_URL}
    />,
  )
}

export async function sendTaskSurrenderedOwnerEmail({
  to,
  ownerName,
  volunteerName,
  taskTitle,
  projectTitle,
  projectId,
}: {
  to: string
  ownerName: string
  volunteerName: string
  taskTitle: string
  projectTitle: string
  projectId: number
}): Promise<boolean> {
  const subject = `Task unassigned due to inactivity: ${taskTitle}`
  return sendEmail(
    to,
    subject,
    await buildTaskSurrenderedOwnerHtml(
      ownerName,
      volunteerName,
      taskTitle,
      projectTitle,
      projectId,
    ),
  )
}

export function buildTaskSurrenderedAssigneeHtml(
  name: string,
  taskTitle: string,
  projectTitle: string,
  projectId: number,
): Promise<string> {
  return render(
    <TaskSurrenderedAssigneeEmail
      name={name}
      taskTitle={taskTitle}
      projectTitle={projectTitle}
      projectId={projectId}
      appUrl={env.APP_URL}
    />,
  )
}

export async function sendTaskSurrenderedAssigneeEmail({
  to,
  name,
  taskTitle,
  projectTitle,
  projectId,
}: {
  to: string
  name: string
  taskTitle: string
  projectTitle: string
  projectId: number
}): Promise<boolean> {
  const subject = `Update on your task: ${taskTitle}`
  return sendEmail(
    to,
    subject,
    await buildTaskSurrenderedAssigneeHtml(name, taskTitle, projectTitle, projectId),
  )
}

export function buildDailySummaryHtml(
  name: string,
  sections: SummaryEmailSection[],
): Promise<string> {
  return render(<DailySummaryEmail name={name} sections={sections} appUrl={env.APP_URL} />)
}

export async function sendDailySummaryEmail({
  to,
  name,
  subject,
  sections,
}: {
  to: string
  name: string
  subject: string
  sections: SummaryEmailSection[]
}): Promise<boolean> {
  return sendEmail(to, subject, await buildDailySummaryHtml(name, sections))
}
