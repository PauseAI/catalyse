import { z } from 'zod'
import { MUTABLE_EMAIL_CATEGORIES } from './notification-categories'
import {
  AdminInviteSchema,
  AdminNoteSchema,
  BugReportSchema,
  LocalGroupSchema,
  LocalGroupSuggestionSchema,
  SkillSchema,
  SkillCategorySchema,
  TaskStatusSchema,
  TeamSchema,
  TeamSuggestionSchema,
  WorkItemSchema,
  WorkItemCommentSchema,
  VolunteerSchema,
} from '@/generated/zod'

const BASE_OMIT = { id: true, createdAt: true, updatedAt: true } as const

// ─── Volunteer text fields ───────────────────────────────────────────────────

// A name is shown to every admin and volunteer and lands in emails sent from this domain,
// so it must not be able to carry a link or hide characters: no slashes or "www.", no
// control characters, and none of the zero-width and bidirectional-override code points.
const NAME_FORBIDDEN = /[/\\]|www\.|[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/i

export const PersonNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(80, 'Name must be 80 characters or fewer')
  .refine((name) => !NAME_FORBIDDEN.test(name), {
    message: 'Name cannot contain links or special characters',
  })

/** A name from a source that cannot be asked to retype it, such as a Google profile. */
export function sanitisePersonName(name: string): string {
  const cleaned = name.replace(new RegExp(NAME_FORBIDDEN.source, 'gi'), ' ').replace(/\s+/g, ' ')
  return cleaned.trim().slice(0, 80).trim() || 'New volunteer'
}

const shortText = (label: string, max: number) =>
  z.string().max(max, `${label} must be ${max} characters or fewer`)

/** Bounds shared by signup and profile edits, so neither is a way round the other. */
const VOLUNTEER_TEXT_LIMITS = {
  discordHandle: shortText('Discord handle', 100).nullable().optional(),
  signalNumber: shortText('Signal number', 100).nullable().optional(),
  whatsappNumber: shortText('WhatsApp number', 100).nullable().optional(),
  contactPreference: shortText('Contact preference', 100).nullable().optional(),
  contactNotes: shortText('Contact notes', 500).nullable().optional(),
  location: shortText('Location', 200).nullable().optional(),
  localGroup: shortText('Local group', 200).nullable().optional(),
  otherSkills: shortText('Other skills', 500).nullable().optional(),
  skillIds: z.array(z.number().int()).max(50, 'Choose 50 skills or fewer').optional(),
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const SignupSchema = VolunteerSchema.pick({
  name: true,
  bio: true,
  discordHandle: true,
  signalNumber: true,
  whatsappNumber: true,
  contactPreference: true,
  contactNotes: true,
  availabilityHoursPerWeek: true,
  location: true,
  country: true,
  localGroup: true,
  otherSkills: true,
  consentMakeProfileVisibleInDirectory: true,
  consentContactableByProjectOwners: true,
  consentShareContactInfoWithProjectOwner: true,
  cookieConsentAnalytics: true,
  emailDigest: true,
  applicationMessage: true,
})
  .partial({
    discordHandle: true,
    signalNumber: true,
    whatsappNumber: true,
    contactPreference: true,
    contactNotes: true,
    location: true,
    localGroup: true,
    otherSkills: true,
    consentMakeProfileVisibleInDirectory: true,
    consentContactableByProjectOwners: true,
    consentShareContactInfoWithProjectOwner: true,
    cookieConsentAnalytics: true,
    emailDigest: true,
    applicationMessage: true,
  })
  .extend({
    ...VOLUNTEER_TEXT_LIMITS,
    name: PersonNameSchema,
    // email is nullable on Volunteer (Google OAuth accounts have none), but required at signup
    email: z
      .string()
      .email('A valid email address is required')
      .max(254, 'Email must be 254 characters or fewer'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be no more than 128 characters'),
    applicationMessage: z
      .string()
      .min(20, 'Please write at least 20 characters')
      .max(5000, 'Application message must be no more than 5000 characters'),
    bio: z
      .string()
      .min(20, 'Please write at least 20 characters')
      .max(2000, 'About You must be no more than 2000 characters'),
    country: z.string().min(1, 'Country is required').max(100),
    availabilityHoursPerWeek: z
      .number()
      .int()
      .min(1, 'Availability is required')
      .max(40, 'Availability must be no more than 40 hours per week'),
  })

export const CompleteGoogleSignupSchema = SignupSchema.omit({
  email: true,
  password: true,
  name: true,
}).extend({
  credential: z.string().optional(),
  stub: z.boolean().optional(),
})

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password must be no more than 128 characters'),
})

export const ChangeEmailSchema = z.object({
  newEmail: z
    .string()
    .trim()
    .min(1, 'New email is required')
    .email('A valid email address is required')
    .max(254, 'Email must be 254 characters or fewer'),
  password: z.string().min(1, 'Password is required'),
})

export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password must be no more than 128 characters'),
})

// ─── Projects ─────────────────────────────────────────────────────────────────

const TaskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
})

/** Timeline fields shared by PROJECT and TASK. See lib/schedule.ts. */
const SCHEDULE_INPUT_FIELDS = {
  startDate: true,
  durationDays: true,
} as const

const PROJECT_INPUT_FIELDS = {
  title: true,
  description: true,
  projectType: true,
  estimatedDuration: true,
  timeCommitmentHoursPerWeek: true,
  urgency: true,
  collaborationLink: true,
  country: true,
  localGroup: true,
  remoteEligibility: true,
  isSeekingHelp: true,
  teamId: true,
  ...SCHEDULE_INPUT_FIELDS,
} as const

const HTTP_URL_RE = /^https?:\/\/\S+$/i

/** A link the app will render as an href: http(s) only, so it can never run script. */
export const isHttpUrl = (value: string | null | undefined): value is string =>
  typeof value === 'string' && HTTP_URL_RE.test(value)

/** A user-supplied link, empty allowed; the caller decides whether empty means null. */
export const HttpUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => u === '' || isHttpUrl(u), {
    message: 'The link must start with http:// or https://',
  })

export const CreateProjectSchema = WorkItemSchema.pick(PROJECT_INPUT_FIELDS)
  .partial({ remoteEligibility: true, teamId: true, ...SCHEDULE_INPUT_FIELDS })
  .extend({
    collaborationLink: HttpUrlSchema.nullable(),
    tasks: z.array(TaskInputSchema).optional().default([]),
    wantToOwn: z.boolean().optional().default(false),
    skillIds: z.array(z.number().int()).optional().default([]),
    skillRequiredMap: z.record(z.string(), z.boolean()).optional().default({}),
    saveAsDraft: z.boolean().optional().default(false),
  })

export const UpdateProjectSchema = WorkItemSchema.pick({
  ...PROJECT_INPUT_FIELDS,
  status: true,
  assigneeId: true,
  outcome: true,
  outcomeNotes: true,
  autoAcceptTasks: true,
  deadline: true,
})
  .partial()
  .extend({
    collaborationLink: HttpUrlSchema.nullable().optional(),
    skillIds: z.array(z.number().int()).optional(),
    skillRequiredMap: z.record(z.string(), z.boolean()).optional(),
  })

export const ProjectInterestBodySchema = z.object({
  interestType: z.enum(['want_to_contribute', 'want_to_own'], {
    error: 'Invalid interestType',
  }),
  message: z.string().optional().nullable(),
})

export const CreateProjectTaskSchema = WorkItemSchema.pick({
  title: true,
  description: true,
  estimatedHours: true,
  deadline: true,
  featuredAsQuickTask: true,
  timing: true,
  ...SCHEDULE_INPUT_FIELDS,
}).partial({
  description: true,
  estimatedHours: true,
  deadline: true,
  featuredAsQuickTask: true,
  timing: true,
  ...SCHEDULE_INPUT_FIELDS,
})

export const UpdateProjectTaskSchema = WorkItemSchema.pick({
  title: true,
  description: true,
  assigneeId: true,
  estimatedHours: true,
  deadline: true,
  featuredAsQuickTask: true,
  isAnchor: true,
  timing: true,
  ...SCHEDULE_INPUT_FIELDS,
})
  .partial()
  .extend({ status: TaskStatusSchema.optional() })

/** A finish-to-start link. Lag is signed: positive leaves a gap, negative overlaps. */
export const DependencyBodySchema = z.object({
  predecessorId: z.number().int(),
  successorId: z.number().int(),
  lagDays: z.number().int().min(-365).max(365).optional().default(0),
})

export const CreateProjectUpdateSchema = WorkItemCommentSchema.pick({
  content: true,
})

// ─── Admin: projects ──────────────────────────────────────────────────────────

export const AdminCreateProjectSchema = WorkItemSchema.pick(PROJECT_INPUT_FIELDS)
  .partial({ remoteEligibility: true, teamId: true, ...SCHEDULE_INPUT_FIELDS })
  .extend({
    tasks: z.array(TaskInputSchema).optional().default([]),
    wantToOwn: z.boolean().optional().default(false),
    skillIds: z.array(z.number().int()).optional().default([]),
    skillRequiredMap: z.record(z.string(), z.boolean()).optional().default({}),
    saveAsDraft: z.boolean().optional().default(false),
  })

export const ReviewProjectSchema = z.object({
  status: z.enum(['approved', 'needs_discussion'], {
    error: 'Status must be approved or needs_discussion',
  }),
  reviewNotes: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
})

export const OutcomeProjectSchema = z.object({
  outcome: z.enum(['successful', 'partial', 'not_completed', 'ongoing'], {
    error: 'Invalid outcome',
  }),
  outcomeNotes: z.string().optional().nullable(),
})

// ─── Admin: applications ──────────────────────────────────────────────────────

export const ApplicationActionSchema = z.object({
  action: z.enum(['start_review', 'approve', 'reject', 'update_notes', 'request_info', 'reopen'], {
    error:
      'action must be "start_review", "approve", "reject", "update_notes", "request_info", or "reopen"',
  }),
  adminNotes: z.string().optional().nullable(),
  applicantNotes: z.string().optional().nullable(),
})

// ─── Admin: notes ─────────────────────────────────────────────────────────────

export const CreateNoteSchema = AdminNoteSchema.pick({
  content: true,
  category: true,
  relatedWorkItemId: true,
}).partial({ category: true, relatedWorkItemId: true })

export const UpdateNoteSchema = AdminNoteSchema.pick({
  content: true,
  category: true,
}).partial()

// ─── Admin: skills ────────────────────────────────────────────────────────────

export const CreateSkillSchema = SkillSchema.pick({
  name: true,
  categoryId: true,
  description: true,
  sortOrder: true,
}).partial({ description: true, sortOrder: true })

export const UpdateSkillSchema = SkillSchema.pick({
  name: true,
  description: true,
  sortOrder: true,
  categoryId: true,
}).partial()

// ─── Admin: skill categories ──────────────────────────────────────────────────

export const CreateSkillCategorySchema = SkillCategorySchema.pick({
  name: true,
  description: true,
  sortOrder: true,
}).partial({ description: true, sortOrder: true })

export const UpdateSkillCategorySchema = SkillCategorySchema.pick({
  name: true,
  description: true,
  sortOrder: true,
}).partial()

// ─── Admin: local groups ──────────────────────────────────────────────────────

export const LocalGroupBodySchema = LocalGroupSchema.pick({
  name: true,
  country: true,
})

// ─── Admin: bug reports ───────────────────────────────────────────────────────

export const UpdateBugReportSchema = BugReportSchema.pick({
  status: true,
  resolutionNotes: true,
}).partial()

// ─── Admin: local group suggestions ──────────────────────────────────────────

export const ReviewSuggestionSchema = z.object({
  action: z.enum(['accept', 'merge', 'on_hold', 'decline'], {
    error: 'Invalid action',
  }),
  adminNotes: z.string().optional().nullable(),
  name: z.string().optional(),
  country: z.string().optional(),
  mergedIntoId: z.number().int().optional().nullable(),
})

// ─── Admin: teams ─────────────────────────────────────────────────────────────

export const TeamBodySchema = TeamSchema.pick({
  name: true,
  description: true,
  lumaUrl: true,
  docUrl: true,
})

export const ReviewTeamSuggestionSchema = z.object({
  action: z.enum(['accept', 'merge', 'on_hold', 'decline'], {
    error: 'Invalid action',
  }),
  adminNotes: z.string().optional().nullable(),
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  mergedIntoId: z.number().int().optional().nullable(),
  // 'accept' only — who becomes the new team's first leader. Defaults to the suggester.
  leaderId: z.number().int().optional(),
})

// ─── Admin: invite ────────────────────────────────────────────────────────────

export const InviteAdminSchema = AdminInviteSchema.pick({
  email: true,
})

// ─── Admin: platform settings ─────────────────────────────────────────────────

export const PlatformSettingsSchema = z.object({
  requireApplicationApproval: z
    .boolean({ message: 'requireApplicationApproval must be a boolean' })
    .optional(),
  maintenanceMode: z.boolean({ message: 'maintenanceMode must be a boolean' }).optional(),
})

// ─── Quick tasks ──────────────────────────────────────────────────────────────

export const CreateQuickTaskSchema = WorkItemSchema.pick({
  title: true,
  description: true,
  skillId: true,
  contextProjectId: true,
  estimatedHours: true,
  deadline: true,
}).partial({ skillId: true, contextProjectId: true, estimatedHours: true, deadline: true })

export const AssignQuickTaskSchema = z.object({
  volunteerId: z.number().int({ message: 'volunteerId is required' }),
})

/** Handing in a task. At least one of the two is required; `submissionData` checks that. */
export const SubmitWorkSchema = z.object({
  note: z.string().trim().max(5000).optional().nullable(),
  url: HttpUrlSchema.optional().nullable(),
})

export const RequestChangesSchema = z.object({
  message: z.string().trim().min(1, { message: 'Say what needs changing' }).max(5000),
})

export const ReviewQuickTaskSchema = z.object({
  reviewRating: z.enum(['excellent', 'good', 'needs_improvement'], {
    error: 'reviewRating must be excellent, good, or needs_improvement',
  }),
  reviewNotes: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
})

// ─── Bug reports ──────────────────────────────────────────────────────────────

export const CreateBugReportSchema = BugReportSchema.pick({
  title: true,
  description: true,
  pageUrl: true,
  category: true,
  severity: true,
}).partial({ pageUrl: true, category: true, severity: true })

// ─── Local group suggestions ──────────────────────────────────────────────────

export const LocalGroupSuggestionBodySchema = LocalGroupSuggestionSchema.pick({
  name: true,
  country: true,
})

export const TeamSuggestionBodySchema = TeamSuggestionSchema.pick({
  name: true,
  description: true,
})

// ─── Volunteer profile ────────────────────────────────────────────────────────

export const UpdateVolunteerSchema = VolunteerSchema.omit({
  ...BASE_OMIT,
  email: true,
  isAdmin: true,
  approvalStatus: true,
  applicationAdminNotes: true,
  applicationApplicantNotes: true,
  consentGivenAt: true,
  rejectedAt: true,
  reviewerId: true,
  emailConfirmed: true,
  deletedAt: true,
  locationConfirmedAt: true,
})
  .partial()
  .extend({
    ...VOLUNTEER_TEXT_LIMITS,
    name: PersonNameSchema.optional(),
    bio: shortText('About You', 2000).nullable().optional(),
    applicationMessage: z
      .string()
      .min(20, 'Please write at least 20 characters')
      .max(5000, 'Application message must be no more than 5000 characters')
      .nullable()
      .optional(),
    emailMutedCategories: z.array(z.enum(MUTABLE_EMAIL_CATEGORIES)).optional(),
    dailySummary: z.enum(['email_and_in_app', 'in_app_only', 'off']).optional(),
  })
