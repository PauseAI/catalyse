import { z } from 'zod'
import type {
  SignupSchema,
  ChangePasswordSchema,
  ChangeEmailSchema,
  ResetPasswordSchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectInterestBodySchema,
  CreateProjectTaskSchema,
  UpdateProjectTaskSchema,
  CreateProjectUpdateSchema,
  AdminCreateProjectSchema,
  ReviewProjectSchema,
  OutcomeProjectSchema,
  ApplicationActionSchema,
  CreateNoteSchema,
  UpdateNoteSchema,
  CreateSkillSchema,
  UpdateSkillSchema,
  CreateSkillCategorySchema,
  UpdateSkillCategorySchema,
  LocalGroupBodySchema,
  TeamBodySchema,
  ReviewTeamSuggestionSchema,
  TeamSuggestionBodySchema,
  UpdateBugReportSchema,
  ReviewSuggestionSchema,
  InviteChapterStaffSchema,
  PlatformSettingsSchema,
  CreateQuickTaskSchema,
  AssignQuickTaskSchema,
  ReviewQuickTaskSchema,
  CreateBugReportSchema,
  LocalGroupSuggestionBodySchema,
  UpdateVolunteerSchema,
} from './schemas'
import type { withProjectExtras } from './work-item'
import type { redactVolunteer } from './auth'

// ─── Request body types ───────────────────────────────────────────────────────

export type SignupBody = z.infer<typeof SignupSchema>
export type ChangePasswordBody = z.infer<typeof ChangePasswordSchema>
export type ChangeEmailBody = z.infer<typeof ChangeEmailSchema>
export type ResetPasswordBody = z.infer<typeof ResetPasswordSchema>

export type CreateProjectBody = z.infer<typeof CreateProjectSchema>
export type UpdateProjectBody = z.infer<typeof UpdateProjectSchema>
export type ProjectInterestBody = z.infer<typeof ProjectInterestBodySchema>
export type CreateProjectTaskBody = z.infer<typeof CreateProjectTaskSchema>
export type UpdateProjectTaskBody = z.infer<typeof UpdateProjectTaskSchema>
export type CreateProjectUpdateBody = z.infer<typeof CreateProjectUpdateSchema>

export type AdminCreateProjectBody = z.infer<typeof AdminCreateProjectSchema>
export type ReviewProjectBody = z.infer<typeof ReviewProjectSchema>
export type OutcomeProjectBody = z.infer<typeof OutcomeProjectSchema>

export type ApplicationActionBody = z.infer<typeof ApplicationActionSchema>
export type CreateNoteBody = z.infer<typeof CreateNoteSchema>
export type UpdateNoteBody = z.infer<typeof UpdateNoteSchema>
export type CreateSkillBody = z.infer<typeof CreateSkillSchema>
export type UpdateSkillBody = z.infer<typeof UpdateSkillSchema>
export type CreateSkillCategoryBody = z.infer<typeof CreateSkillCategorySchema>
export type UpdateSkillCategoryBody = z.infer<typeof UpdateSkillCategorySchema>
export type LocalGroupBody = z.infer<typeof LocalGroupBodySchema>
export type TeamBody = z.infer<typeof TeamBodySchema>
export type ReviewTeamSuggestionBody = z.infer<typeof ReviewTeamSuggestionSchema>
export type TeamSuggestionBody = z.infer<typeof TeamSuggestionBodySchema>
export type UpdateBugReportBody = z.infer<typeof UpdateBugReportSchema>
export type ReviewSuggestionBody = z.infer<typeof ReviewSuggestionSchema>
export type InviteChapterStaffBody = z.infer<typeof InviteChapterStaffSchema>
export type PlatformSettingsBody = z.infer<typeof PlatformSettingsSchema>

export type CreateQuickTaskBody = z.infer<typeof CreateQuickTaskSchema>
export type AssignQuickTaskBody = z.infer<typeof AssignQuickTaskSchema>
export type ReviewQuickTaskBody = z.infer<typeof ReviewQuickTaskSchema>

export type CreateBugReportBody = z.infer<typeof CreateBugReportSchema>
export type LocalGroupSuggestionBody = z.infer<typeof LocalGroupSuggestionBodySchema>
export type UpdateVolunteerBody = z.infer<typeof UpdateVolunteerSchema>

// ─── Response / serializer types ─────────────────────────────────────────────

export type SerializedProject = ReturnType<typeof withProjectExtras>
export type SerializedVolunteer = ReturnType<typeof redactVolunteer>
