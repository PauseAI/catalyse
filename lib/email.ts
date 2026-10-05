import { env } from './env'
import { emailTransport } from './email-transport'

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

const baseStyle = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a202c; }
  .container { max-width: 500px; margin: 0 auto; padding: 20px; }
  .button { display: inline-block; background: #FF9416; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #718096; }
`

function footer(buttons: Array<[string, string]> = []): string {
  const fallbacks = buttons
    .map(
      ([label, url]) =>
        `<p style="font-size: 12px;">If the "${escapeHtml(label)}" button doesn't work, copy this link: <a href="${escapeHtml(url)}" style="color: #718096; word-break: break-all;">${escapeHtml(url)}</a></p>`,
    )
    .join('')
  return `<div class="footer">
    <p>Catalyse - PauseAI Volunteer Platform - This is an automated email</p>
    ${fallbacks}
    <p style="font-size: 12px;"><a href="${env.APP_URL}/profile">Manage notification preferences</a></p>
  </div>`
}

export function buildWelcomeAndConfirmHtml(name: string, confirmUrl: string): string {
  const n = escapeHtml(name)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Welcome to Catalyse!</h2>
  <p>Hi ${n},</p>
  <p>Thanks for joining the PauseAI volunteer community! We're excited to have you.</p>
  <ul>
    <li><strong>Browse projects</strong> - Find opportunities that match your skills</li>
    <li><strong>Complete your profile</strong> - Help project owners find you</li>
    <li><strong>Express interest</strong> - Let project owners know you want to help</li>
  </ul>
  <p>Please confirm your email address to continue.</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${confirmUrl}" class="button">Confirm Email</a></p>
  <p>This link will expire in <strong>24 hours</strong>.</p>
  <p>If you didn't sign up for Catalyse, you can safely ignore this email.</p>
  ${footer([['Confirm Email', confirmUrl]])}
</div></body></html>`
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
    buildWelcomeAndConfirmHtml(name, confirmUrl),
  )
}

export function buildApplicationReceivedHtml(name: string): string {
  const n = escapeHtml(name)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Application Received</h2>
  <p>Hi ${n},</p>
  <p>Thanks for applying to join Catalyse, the PauseAI volunteer platform. We've received your application and will review it shortly.</p>
  <p>You'll receive an email as soon as we've reviewed your request to join.</p>
  ${footer()}
</div></body></html>`
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
    buildApplicationReceivedHtml(name),
  )
}

export function buildApplicationApprovedHtml(name: string, appUrl: string): string {
  const n = escapeHtml(name)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Welcome to Catalyse!</h2>
  <p>Hi ${n},</p>
  <p>Thank you for applying to join Catalyse PauseAI. Welcome to the community!</p>
  <p>Your account has been approved and you can now sign in.</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${appUrl}/login" class="button">Sign In</a></p>
  ${footer([['Sign In', `${appUrl}/login`]])}
</div></body></html>`
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
    buildApplicationApprovedHtml(name, env.APP_URL),
  )
}

export function buildApplicationRejectedHtml(name: string, applicantNotes?: string): string {
  const n = escapeHtml(name)
  const notesHtml = applicantNotes
    ? `<p><strong>Feedback from the team:</strong></p>
  <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; white-space: pre-wrap;">${escapeHtml(applicantNotes)}</div>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Update on your Catalyse application</h2>
  <p>Hi ${n},</p>
  <p>Thank you for applying to join Catalyse PauseAI. Unfortunately we're unable to approve your application at this time.</p>
  ${notesHtml}
  <p>You can contact <a href="mailto:uk@pauseai.info">uk@pauseai.info</a> if you have any queries.</p>
  ${footer()}
</div></body></html>`
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
    buildApplicationRejectedHtml(name, applicantNotes),
  )
}

export function buildApplicationNeedsInfoHtml(
  name: string,
  loginUrl: string,
  applicantNotes?: string,
): string {
  const n = escapeHtml(name)
  const notesHtml = applicantNotes
    ? `<div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; white-space: pre-wrap;">${escapeHtml(applicantNotes)}</div>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>We need a bit more information</h2>
  <p>Hi ${n},</p>
  <p>Thanks for applying to join Catalyse PauseAI. Before we can finish reviewing your application, we need some more information from you:</p>
  ${notesHtml}
  <p>Log in to your account to update your application and resubmit it for review.</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${loginUrl}" class="button">Log In</a></p>
  ${footer([['Log In', loginUrl]])}
</div></body></html>`
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
    buildApplicationNeedsInfoHtml(name, loginUrl, applicantNotes),
  )
}

export function buildApplicationReopenedHtml(
  name: string,
  loginUrl: string,
  applicantNotes?: string,
): string {
  const n = escapeHtml(name)
  const notesHtml = applicantNotes
    ? `<div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; white-space: pre-wrap;">${escapeHtml(applicantNotes)}</div>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Your Catalyse application has been reopened</h2>
  <p>Hi ${n},</p>
  <p>We've reopened your application to join Catalyse PauseAI so it can be reviewed again.</p>
  ${notesHtml}
  <p>Log in to your account to update your application and resubmit it for review.</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${loginUrl}" class="button">Log In</a></p>
  ${footer([['Log In', loginUrl]])}
</div></body></html>`
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
    buildApplicationReopenedHtml(name, loginUrl, applicantNotes),
  )
}

export function buildPendingApplicationsSummaryHtml(count: number, appUrl: string): string {
  const plural = count === 1 ? 'application' : 'applications'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Pending Applications</h2>
  <p>There ${count === 1 ? 'is' : 'are'} <strong>${count}</strong> pending ${plural} waiting for review on Catalyse.</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${appUrl}/admin/applications" class="button">Review Applications</a></p>
  ${footer([['Review Applications', `${appUrl}/admin/applications`]])}
</div></body></html>`
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
    buildPendingApplicationsSummaryHtml(count, env.APP_URL),
  )
}

export function buildPasswordResetHtml(resetUrl: string, name: string): string {
  const n = escapeHtml(name)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Reset Your Password</h2>
  <p>Hi ${n},</p>
  <p>We received a request to reset your password for your Catalyse account. Click the button below to choose a new password:</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${resetUrl}" class="button">Reset Password</a></p>
  <p>This link will expire in <strong>1 hour</strong>.</p>
  <p>If you didn't request this, you can safely ignore this email. Your password won't be changed.</p>
  ${footer([['Reset Password', resetUrl]])}
</div></body></html>`
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
  return sendEmail(to, 'Reset your Catalyse password', buildPasswordResetHtml(resetUrl, name))
}

export function buildOutreachLoginHtml(loginUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Your journalist outreach link</h2>
  <p>Hi there,</p>
  <p>Thanks for helping with People for a Pause journalist outreach. Click the button below to start:</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${loginUrl}" class="button">Start outreach</a></p>
  <p>This link will expire in <strong>1 hour</strong> and can be used once.</p>
  <p>If you didn't request this, you can safely ignore this email.</p>
  ${footer([['Start outreach', loginUrl]])}
</div></body></html>`
}

export async function sendOutreachLoginEmail({
  to,
  loginToken,
}: {
  to: string
  loginToken: string
}): Promise<boolean> {
  const loginUrl = `${env.APP_URL}/people-for-a-pause-protest-journalist-outreach/verify?token=${loginToken}`
  return sendEmail(to, 'Your People for a Pause outreach link', buildOutreachLoginHtml(loginUrl))
}

export function buildAdminInviteHtml(inviteUrl: string, invitedBy: string): string {
  const by = escapeHtml(invitedBy)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>You're Invited to be a Catalyse Admin</h2>
  <p>Hi there,</p>
  <p><strong>${by}</strong> has invited you to become an admin on Catalyse, the PauseAI volunteer coordination platform.</p>
  <ul>
    <li>Review and approve volunteer-proposed projects</li>
    <li>Manage skills and Quick Tasks</li>
    <li>View volunteer profiles and add notes</li>
    <li>Invite other admins</li>
  </ul>
  <p style="text-align: center; margin: 32px 0;"><a href="${inviteUrl}" class="button">Accept Invitation</a></p>
  <p>This invitation expires in <strong>7 days</strong>.</p>
  <p>You'll need to sign up or log in with this email address to accept.</p>
  ${footer([['Accept Invitation', inviteUrl]])}
</div></body></html>`
}

export async function sendAdminInviteEmail({
  to,
  inviteToken,
  invitedBy,
}: {
  to: string
  inviteToken: string
  invitedBy: string
}): Promise<boolean> {
  const inviteUrl = `${env.APP_URL}/accept-invite?token=${inviteToken}`
  return sendEmail(
    to,
    `${invitedBy} invited you to be a Catalyse admin`,
    buildAdminInviteHtml(inviteUrl, invitedBy),
  )
}

export function buildWelcomeHtml(name: string, appUrl: string): string {
  const n = escapeHtml(name)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Welcome to Catalyse!</h2>
  <p>Hi ${n},</p>
  <p>Thanks for joining the PauseAI volunteer community! We're excited to have you.</p>
  <ul>
    <li><strong>Browse projects</strong> - Find opportunities that match your skills</li>
    <li><strong>Complete your profile</strong> - Help project owners find you</li>
    <li><strong>Express interest</strong> - Let project owners know you want to help</li>
  </ul>
  <p style="text-align: center; margin: 32px 0;"><a href="${appUrl}" class="button">Explore Projects</a></p>
  ${footer([['Explore Projects', appUrl]])}
</div></body></html>`
}

export async function sendWelcomeEmail({
  to,
  name,
}: {
  to: string
  name: string
}): Promise<boolean> {
  return sendEmail(to, 'Welcome to Catalyse!', buildWelcomeHtml(name, env.APP_URL))
}

export function buildProjectNotificationHtml(
  name: string,
  subject: string,
  message: string,
  projectId: number,
  appUrl: string,
  extraHtml = '',
): string {
  const n = escapeHtml(name)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>${escapeHtml(subject)}</h2>
  <p>Hi ${n},</p>
  <p>${message}</p>
  ${extraHtml}
  <p style="text-align: center; margin: 32px 0;">
    <a href="${appUrl}/projects/${projectId}" class="button">View Project</a>
  </p>
  ${footer([['View Project', `${appUrl}/projects/${projectId}`]])}
</div></body></html>`
}

export function buildAdminAlertHtml(
  name: string,
  subject: string,
  message: string,
  ctaLabel: string,
  ctaUrl: string,
): string {
  const n = escapeHtml(name)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>${escapeHtml(subject)}</h2>
  <p>Hi ${n},</p>
  <p>${message}</p>
  <p style="text-align: center; margin: 32px 0;">
    <a href="${escapeHtml(ctaUrl)}" class="button">${escapeHtml(ctaLabel)}</a>
  </p>
  ${footer([[ctaLabel, ctaUrl]])}
</div></body></html>`
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
  return sendEmail(to, subject, buildAdminAlertHtml(name, subject, message, ctaLabel, url))
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
    buildProjectNotificationHtml(name, subject, message, projectId, env.APP_URL, extraHtml),
  )
}

const LOCAL_GROUP_SUGGESTION_MESSAGES: Record<string, (groupName: string) => string> = {
  accepted: (g) =>
    `Great news! Your suggestion <strong>"${g}"</strong> has been added as a new local group on Catalyse.`,
  merge: (g) =>
    `Your suggestion <strong>"${g}"</strong> has been merged with an existing local group.`,
  on_hold: (g) =>
    `Your local group suggestion <strong>"${g}"</strong> is currently under review. We'll be in touch if we need more information.`,
  declined: (g) =>
    `Thanks for your suggestion of <strong>"${g}"</strong>. After review, we've decided not to add it as a separate local group at this time.`,
}

export function buildLocalGroupSuggestionHtml(
  name: string,
  action: string,
  groupName: string,
  adminNotes?: string | null,
): string {
  const n = escapeHtml(name)
  const g = escapeHtml(groupName)
  const getMessage = LOCAL_GROUP_SUGGESTION_MESSAGES[action]
  const message = getMessage
    ? getMessage(g)
    : `Your local group suggestion "${g}" has been reviewed.`
  const notesHtml = adminNotes ? `<p><em>${escapeHtml(adminNotes)}</em></p>` : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Local Group Suggestion Update</h2>
  <p>Hi ${n},</p>
  <p>${message}</p>
  ${notesHtml}
  <p style="text-align: center; margin: 32px 0;"><a href="${env.APP_URL}" class="button">Visit Catalyse</a></p>
  ${footer()}
</div></body></html>`
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
  return sendEmail(to, subject, buildLocalGroupSuggestionHtml(name, action, groupName, adminNotes))
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
): string {
  const to = escapeHtml(toName)
  const from = escapeHtml(fromName)
  const subj = escapeHtml(subject)
  const msg = escapeHtml(message)
  const projectContext = projectTitle
    ? ` about the project <strong>${escapeHtml(projectTitle)}</strong>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${baseStyle}
  .message-box { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; white-space: pre-wrap; }
  </style></head>
<body><div class="container">
  <h2>Message from ${from}</h2>
  <p>Hi ${to},</p>
  <p><strong>${from}</strong> has sent you a message via Catalyse${projectContext}:</p>
  <div class="message-box">
    <p style="font-weight: 500; margin-bottom: 8px;">${subj}</p>
    <p>${msg}</p>
  </div>
  <p><a href="${threadUrl}" class="button">Reply on Catalyse</a></p>
  ${repliesByEmail ? `<p>You can also reply to this email to write to ${from} directly.</p>` : ''}
  ${footer()}
</div></body></html>`
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
  const html = buildRelayMessageHtml(
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
  projects: Array<{
    id: number
    title: string
    description?: string
    skill_names?: string[]
    match_percent?: number
  }>,
  isMatch = false,
): string {
  const matchIntro = isMatch
    ? 'Here are new projects that match your skills:'
    : "Here's what's new on Catalyse:"
  const projectHtml = projects
    .map((p) => {
      const skillsHtml = (p.skill_names || []).slice(0, 5).map(escapeHtml).join(', ')
      const matchBadge = p.match_percent
        ? ` <span style="background: #D1FAE5; color: #065F46; padding: 2px 8px; border-radius: 10px; font-size: 12px;">${p.match_percent}% match</span>`
        : ''
      const desc = escapeHtml(p.description || '')
      const title = escapeHtml(p.title)
      return `<div style="padding: 16px; margin-bottom: 12px; background: #f7fafc; border-radius: 8px; border-left: 4px solid #FF9416;">
      <a href="${appUrl}/projects/${p.id}" style="font-weight: bold; color: #1A202C; text-decoration: none; font-size: 16px;">${title}</a>${matchBadge}
      <p style="color: #4A5568; margin: 8px 0 4px 0; font-size: 14px;">${desc.slice(0, 150)}${desc.length > 150 ? '...' : ''}</p>
      ${skillsHtml ? `<p style="font-size: 12px; color: #718096;">Skills: ${skillsHtml}</p>` : ''}
    </div>`
    })
    .join('')
  const n = escapeHtml(name)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${baseStyle}
  .container { max-width: 600px; }
  </style></head>
<body><div class="container">
  <h2>Catalyse Project Update</h2>
  <p>Hi ${n},</p>
  <p>${matchIntro}</p>
  ${projectHtml}
  <p style="text-align: center; margin: 32px 0;"><a href="${appUrl}" class="button">Browse All Projects</a></p>
  ${footer([['Browse All Projects', appUrl]])}
</div></body></html>`
}

export async function sendDigestEmail({
  to,
  name,
  projects,
  isMatch = false,
}: {
  to: string
  name: string
  projects: Array<{
    id: number
    title: string
    description?: string
    skill_names?: string[]
    match_percent?: number
  }>
  isMatch?: boolean
}): Promise<boolean> {
  if (!projects.length) return false
  const html = buildDigestHtml(name, env.APP_URL, projects, isMatch)
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
): string {
  const n = escapeHtml(name)
  const tt = escapeHtml(taskTitle)
  const pt = escapeHtml(projectTitle)
  const taskUrl = `${env.APP_URL}/projects/${projectId}#task-${taskId}`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>How's it going?</h2>
  <p>Hi ${n},</p>
  <p>It's been ${daysInactive} days since ${activityPhrase} <strong>${tt}</strong> in the project <strong>${pt}</strong> (on ${lastActivityDate}).</p>
  <p>Could you leave a quick comment with a progress update? Even a brief note, like "ticking along, awaiting XYZ, will post another update in 2 weeks", is really helpful so the project team knows things are in good hands.</p>
  <p>If you don't have capacity for the task right now, it's much better to update the project page with an ETA than for the team not to know what's happening.</p>
  <p>We'll send another reminder in a week if we haven't heard from you, it's important that things move along smoothly so everyone can make progress.</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${taskUrl}" class="button">Leave an update</a></p>
  <p>If you can no longer work on this task, please release it so someone else can pick it up.</p>
  <p>If you need support, please contact your project owner or admin.</p>
  ${footer([['Leave an update', taskUrl]])}
</div></body></html>`
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
    buildTaskNudgeHtml(
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
): string {
  const n = escapeHtml(name)
  const tt = escapeHtml(taskTitle)
  const pt = escapeHtml(projectTitle)
  const taskUrl = `${env.APP_URL}/projects/${projectId}#task-${taskId}`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${baseStyle}
  .warning { background: #FFF3CD; border-left: 4px solid #FF9416; padding: 12px 16px; border-radius: 4px; margin: 16px 0; }
  </style></head>
<body><div class="container">
  <h2>One more nudge</h2>
  <p>Hi ${n},</p>
  <p>It's now been ${daysInactive} days since ${activityPhrase} <strong>${tt}</strong> in <strong>${pt}</strong> (on ${lastActivityDate}).</p>
  <div class="warning">
    <strong>If there is no update by ${surrenderDate}, we'll open the task to other contributors</strong> so the project can keep moving forward.
  </div>
  <p>Even a quick note is fine: anything to let the project team know you're still on it. If life has got busy, no worries at all, but it would really help to either leave an update or release the task so someone else can step in.</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${taskUrl}" class="button">Leave an update</a></p>
  <p>If you need support, please contact your project owner or a platform admin.</p>
  ${footer([['Leave an update', taskUrl]])}
</div></body></html>`
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
    buildTaskFinalWarningHtml(
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
): string {
  const on = escapeHtml(ownerName)
  const vn = escapeHtml(volunteerName)
  const tt = escapeHtml(taskTitle)
  const pt = escapeHtml(projectTitle)
  const projectUrl = `${env.APP_URL}/projects/${projectId}`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Task unassigned due to inactivity</h2>
  <p>Hi ${on},</p>
  <p><strong>${vn}</strong> has been removed from the task <strong>${tt}</strong> in your project <strong>${pt}</strong> after four weeks without an update, despite reminders.</p>
  <p>The task is now open and can be claimed by another contributor.</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${projectUrl}" class="button">View Project</a></p>
  <p>If you need support, please contact your project owner or a platform admin.</p>
  ${footer([['View Project', projectUrl]])}
</div></body></html>`
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
    buildTaskSurrenderedOwnerHtml(ownerName, volunteerName, taskTitle, projectTitle, projectId),
  )
}

export function buildTaskSurrenderedAssigneeHtml(
  name: string,
  taskTitle: string,
  projectTitle: string,
  projectId: number,
): string {
  const n = escapeHtml(name)
  const tt = escapeHtml(taskTitle)
  const pt = escapeHtml(projectTitle)
  const projectUrl = `${env.APP_URL}/projects/${projectId}`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
<body><div class="container">
  <h2>Task now open to other contributors</h2>
  <p>Hi ${n},</p>
  <p>Because we haven't received updates from you on the task <strong>${tt}</strong> in <strong>${pt}</strong> for four weeks, we've opened the task to other contributors and removed you from it.</p>
  <p>We hope things are going well, if you'd still like to contribute, you're always welcome to claim the task again or pick up something else on the project.</p>
  <p style="text-align: center; margin: 32px 0;"><a href="${projectUrl}" class="button">View Project</a></p>
  <p>If you need support, please contact your project owner or a platform admin.</p>
  ${footer([['View Project', projectUrl]])}
</div></body></html>`
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
    buildTaskSurrenderedAssigneeHtml(name, taskTitle, projectTitle, projectId),
  )
}
