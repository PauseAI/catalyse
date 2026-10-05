import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import {
  buildWelcomeAndConfirmHtml,
  buildApplicationReceivedHtml,
  buildApplicationApprovedHtml,
  buildApplicationRejectedHtml,
  buildPendingApplicationsSummaryHtml,
  buildPasswordResetHtml,
  buildAdminInviteHtml,
  buildWelcomeHtml,
  buildProjectNotificationHtml,
  buildLocalGroupSuggestionHtml,
  buildRelayMessageHtml,
  buildDigestHtml,
  buildTaskNudgeHtml,
  buildTaskFinalWarningHtml,
  buildTaskSurrenderedOwnerHtml,
  buildTaskSurrenderedAssigneeHtml,
} from '@/lib/email'
import { adminProcedure } from '../../procedures'
import { env } from '@/lib/env'

const SAMPLE_PROJECTS = [
  {
    id: 1,
    title: 'AI Safety Explainer Series',
    description:
      'Creating accessible explainer content about AI safety concepts for a general audience.',
    skill_names: ['Writing', 'Research'],
    match_percent: 92,
  },
  {
    id: 2,
    title: 'Volunteer Coordination Tool',
    description:
      'Building a lightweight tool to help coordinate volunteers across PauseAI chapters.',
    skill_names: ['TypeScript', 'React'],
    match_percent: 78,
  },
  {
    id: 3,
    title: 'Policy Brief: Compute Governance',
    description:
      'Researching and writing a policy brief on international compute governance frameworks.',
    skill_names: ['Policy', 'Research'],
  },
]

const EMAIL_PREVIEW_REGISTRY: Record<string, { subject: string; build: () => string }> = {
  'welcome-google': {
    subject: 'Welcome to Catalyse!',
    build: () => buildWelcomeHtml('Alex', env.APP_URL),
  },
  'welcome-and-confirm': {
    subject: 'Welcome to Catalyse: please confirm your email',
    build: () =>
      buildWelcomeAndConfirmHtml('Alex', `${env.APP_URL}/verify-email?token=sample-token-abc123`),
  },
  'application-received': {
    subject: 'Your Catalyse application has been received',
    build: () => buildApplicationReceivedHtml('Alex'),
  },
  'application-approved': {
    subject: 'Your Catalyse application has been approved',
    build: () => buildApplicationApprovedHtml('Alex', env.APP_URL),
  },
  'application-rejected': {
    subject: 'Update on your Catalyse application',
    build: () =>
      buildApplicationRejectedHtml(
        'Alex',
        'Unfortunately your application did not meet our current requirements.',
      ),
  },
  'pending-applications-summary': {
    subject: '3 pending applications on Catalyse',
    build: () => buildPendingApplicationsSummaryHtml(3, env.APP_URL),
  },
  'password-reset': {
    subject: 'Reset your Catalyse password',
    build: () =>
      buildPasswordResetHtml(`${env.APP_URL}/reset-password?token=sample-token-abc123`, 'Alex'),
  },
  'admin-invite': {
    subject: 'Jamie Smith invited you to be a Catalyse admin',
    build: () =>
      buildAdminInviteHtml(`${env.APP_URL}/accept-invite?token=sample-token-abc123`, 'Jamie Smith'),
  },
  'project-notification': {
    subject: 'Your project has been approved',
    build: () =>
      buildProjectNotificationHtml(
        'Alex',
        'Your project has been approved',
        'Great news: your project AI Safety Explainer Series has been reviewed and approved.',
        1,
        env.APP_URL,
      ),
  },
  'local-group-suggestion-accepted': {
    subject: 'Your local group suggestion "London" was accepted',
    build: () => buildLocalGroupSuggestionHtml('Alex', 'accepted', 'London'),
  },
  'local-group-suggestion-merge': {
    subject: 'Your local group suggestion "London" has been merged',
    build: () =>
      buildLocalGroupSuggestionHtml('Alex', 'merge', 'London', 'Merged with South London.'),
  },
  'local-group-suggestion-on-hold': {
    subject: 'Your local group suggestion "London" is under review',
    build: () =>
      buildLocalGroupSuggestionHtml(
        'Alex',
        'on_hold',
        'London',
        'We need a bit more time to assess this one.',
      ),
  },
  'local-group-suggestion-declined': {
    subject: 'Update on your local group suggestion "London"',
    build: () =>
      buildLocalGroupSuggestionHtml(
        'Alex',
        'declined',
        'London',
        'We already have good coverage in this area.',
      ),
  },
  'relay-message': {
    subject: '[Catalyse] Collaboration on AI Safety Explainer Series',
    build: () =>
      buildRelayMessageHtml(
        'Alex',
        'Jamie Smith',
        'Collaboration on AI Safety Explainer Series',
        'Hi Alex,\n\nI came across your profile and think your writing skills would be a great fit.\n\nThanks,\nJamie',
        'AI Safety Explainer Series',
        `${env.APP_URL}/inbox/messages/1`,
        false,
      ),
  },
  'digest-match': {
    subject: 'New projects matching your skills',
    build: () => buildDigestHtml('Alex', env.APP_URL, SAMPLE_PROJECTS, true),
  },
  'digest-general': {
    subject: "What's new on Catalyse",
    build: () => buildDigestHtml('Alex', env.APP_URL, SAMPLE_PROJECTS, false),
  },
  'task-nudge': {
    subject: "How's it going with Write fundraising copy?",
    build: () =>
      buildTaskNudgeHtml(
        'Alex',
        'Write fundraising copy',
        'Climate Action Newsletter',
        1,
        42,
        14,
        'you were assigned this task',
        '16 April 2026',
      ),
  },
  'task-final-warning': {
    subject: 'A quick nudge about Write fundraising copy',
    build: () =>
      buildTaskFinalWarningHtml(
        'Alex',
        'Write fundraising copy',
        'Climate Action Newsletter',
        1,
        42,
        21,
        'you last updated this task',
        '9 April 2026',
        '7 May 2026',
      ),
  },
  'task-surrendered-owner': {
    subject: 'Task unassigned due to inactivity: Write fundraising copy',
    build: () =>
      buildTaskSurrenderedOwnerHtml(
        'Jordan',
        'Alex Johnson',
        'Write fundraising copy',
        'Climate Action Newsletter',
        1,
      ),
  },
  'task-surrendered-assignee': {
    subject: 'Update on your task: Write fundraising copy',
    build: () =>
      buildTaskSurrenderedAssigneeHtml(
        'Alex',
        'Write fundraising copy',
        'Climate Action Newsletter',
        1,
      ),
  },
}

export const adminEmailPreviewRouter = {
  types: adminProcedure.handler(async () => ({ types: Object.keys(EMAIL_PREVIEW_REGISTRY) })),

  preview: adminProcedure.input(z.object({ type: z.string() })).handler(async ({ input }) => {
    const entry = EMAIL_PREVIEW_REGISTRY[input.type]
    if (!entry) throw new ORPCError('NOT_FOUND', { message: 'Unknown email type' })
    return { subject: entry.subject, html: entry.build() }
  }),
}
