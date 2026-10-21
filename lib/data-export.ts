import type { RuntimeDataModel } from '@prisma/client/runtime/library'
import { prisma } from '@/lib/prisma'
import { isSuperAdmin } from '@/lib/auth'

/**
 * The data-subject export (GDPR Articles 15 and 20), built from the Prisma schema: every relation
 * that points a row at a Volunteer is a link, and every link must be classified below as exported
 * or omitted. lib/data-export.test.ts fails on a link or a secret-looking column nobody has
 * classified, so a new model holding someone's data cannot be silently included or skipped.
 */

export type DataModel = Pick<RuntimeDataModel, 'models'>
type Row = Record<string, unknown>

const USER_MODEL = 'Volunteer'

/** One way a row of `model` points at a person, named `Model.field` after the relation field. */
export interface UserLink {
  name: string
  model: string
  foreignKey: string
}

/**
 * Rows a person gets in their export: about them, made by them, or sent to them. Notes admins
 * wrote about them are included, as Article 15 entitles them to those too.
 */
export const EXPORTED_LINKS: readonly string[] = [
  'AccountMerge.kept',
  'AccountMerge.merged',
  'AccountMergeRequest.requester',
  'AccountMergeRequest.other',
  'AdminInvite.acceptedBy',
  'AdminNote.volunteer',
  'ApiToken.volunteer',
  'BugReport.reporter',
  'BugReportComment.author',
  'ChapterAuditEvent.targetVolunteer',
  'ChapterDeputy.volunteer',
  'ChapterTransferRequest.volunteer',
  'ContactRequest.from',
  'ContactRequest.to',
  'DeletionRequest.volunteerId',
  'DistinctAccountPair.volunteerA',
  'DistinctAccountPair.volunteerB',
  'EmailVerificationToken.volunteer',
  'FinishByReminder.recipient',
  'LocalGroupSuggestion.suggestedBy',
  'Message.from',
  'Message.to',
  'NationalChapter.lead',
  'Notification.volunteer',
  'PasswordResetToken.volunteer',
  'ProjectDeputy.volunteer',
  'Session.volunteer',
  'SkillEndorsement.volunteer',
  'TeamJoinRequest.volunteer',
  'TeamMembership.volunteer',
  'TeamSuggestion.suggestedBy',
  'Template.createdBy',
  'WorkItem.assignee',
  'WorkItem.creator',
  'WorkItem.requestedBy',
  'WorkItem.stakeholder',
  'WorkItemComment.author',
  'WorkItemDependency.createdBy',
  'WorkItemEvent.actor',
  'WorkItemInterest.volunteer',
]

const STAFF_ACTION = "a decision taken about someone else; it is that person's data"

/** Links left out, each with the reason. */
export const OMITTED_LINKS: Readonly<Record<string, string>> = {
  'AdminInvite.invitedBy': "invites sent to other people's addresses",
  'AdminNote.author': 'notes written about other people',
  'BugReport.assignee': STAFF_ACTION,
  'BugReport.resolvedBy': STAFF_ACTION,
  'ChapterAuditEvent.actor': STAFF_ACTION,
  'ChapterDeputy.appointedBy': STAFF_ACTION,
  'ChapterTransferRequest.decidedBy': STAFF_ACTION,
  'DistinctAccountPair.dismissedBy': STAFF_ACTION,
  'LocalGroupSuggestion.reviewedBy': STAFF_ACTION,
  'ProjectDeputy.appointedBy': STAFF_ACTION,
  'ProjectReviewRequest.requestedBy': STAFF_ACTION,
  'SkillEndorsement.endorsedBy': 'endorsements of other people',
  'TeamJoinRequest.reviewedBy': STAFF_ACTION,
  'TeamSuggestion.reviewedBy': STAFF_ACTION,
  'Volunteer.duplicateOf': "another account's own export covers it",
  'Volunteer.mergedInto': 'merged accounts are listed under AccountMerge',
  'Volunteer.reviewer': 'applications reviewed for other people',
  'VolunteerSkill.volunteer': 'exported as `skills`',
  'WorkItem.reviewedBy': STAFF_ACTION,
  'WorkItemInterest.invitedBy': 'invites to other people',
}

/** Columns never exported: credentials, and the tokens that stand in for them. */
export const SECRET_FIELDS: Readonly<Record<string, readonly string[]>> = {
  AccountMergeRequest: ['token'],
  AdminInvite: ['inviteToken'],
  ApiToken: ['tokenHash'],
  EmailVerificationToken: ['token'],
  PasswordResetToken: ['token'],
  Session: ['tokenHash'],
  Volunteer: ['authToken', 'authTokenExpiresAt', 'passwordHash'],
}

const SECRET_LOOKING = /token|hash|password|secret/i
const PERSON_ID = /^(v|.+V)olunteerId$/

/** Every link to a person in the schema: owning relation fields to Volunteer, plus a bare `volunteerId`-style column with no relation. */
export function userLinks(dataModel: DataModel): UserLink[] {
  const links: UserLink[] = []
  for (const [model, { fields }] of Object.entries(dataModel.models)) {
    const relationKeys = new Set(fields.flatMap((f) => f.relationFromFields ?? []))
    for (const f of fields) {
      if (f.kind === 'object' && f.type === USER_MODEL && f.relationFromFields?.length) {
        links.push({ name: `${model}.${f.name}`, model, foreignKey: f.relationFromFields[0] })
      } else if (f.kind === 'scalar' && PERSON_ID.test(f.name) && !relationKeys.has(f.name)) {
        links.push({ name: `${model}.${f.name}`, model, foreignKey: f.name })
      }
    }
  }
  return links
}

/** What stops the export being trusted: unclassified or stale links, and undeclared secrets. */
export function classificationProblems(dataModel: DataModel): string[] {
  const problems: string[] = []
  const links = userLinks(dataModel).map((l) => l.name)
  const classified = [...EXPORTED_LINKS, ...Object.keys(OMITTED_LINKS)]
  for (const link of links) {
    if (!classified.includes(link))
      problems.push(`${link} is not in EXPORTED_LINKS or OMITTED_LINKS`)
  }
  for (const link of classified) {
    if (!links.includes(link)) problems.push(`${link} is classified but no longer in the schema`)
  }

  const exportedModels = new Set([USER_MODEL, ...EXPORTED_LINKS.map((l) => l.split('.')[0])])
  for (const model of exportedModels) {
    const columns = dataModel.models[model]?.fields.filter((f) => f.kind === 'scalar') ?? []
    const secrets = SECRET_FIELDS[model] ?? []
    for (const { name: field } of columns) {
      if (SECRET_LOOKING.test(field) && !secrets.includes(field))
        problems.push(`${model}.${field} looks secret but is not in SECRET_FIELDS`)
    }
  }
  for (const [model, secrets] of Object.entries(SECRET_FIELDS)) {
    const fields = dataModel.models[model]?.fields.map((f) => f.name) ?? []
    for (const field of secrets) {
      if (!fields.includes(field))
        problems.push(`SECRET_FIELDS names ${model}.${field}, which is not in the schema`)
    }
  }
  return problems
}

/** The schema as the generated client holds it; the `prisma-client` generator exports no `Prisma.dmmf`. */
export function schemaDataModel(): DataModel {
  return (prisma as unknown as { _runtimeDataModel: DataModel })._runtimeDataModel
}

/** A row with its secret columns removed, and any secret-looking column a schema change added. */
function withoutSecrets(model: string, row: Row): Row {
  const secrets = SECRET_FIELDS[model] ?? []
  return Object.fromEntries(
    Object.entries(row).filter(([k]) => !secrets.includes(k) && !SECRET_LOOKING.test(k)),
  )
}

type Delegate = { findMany(args: { where: Row }): Promise<Row[]> }

function delegateFor(model: string): Delegate {
  const key = model[0].toLowerCase() + model.slice(1)
  return (prisma as unknown as Record<string, Delegate>)[key]
}

/**
 * Every exported link's rows for one person, as `{ Model: { link: rows } }`, so a row is filed
 * under how it points at them (`Message.from` is what they sent, `Message.to` what they received).
 */
export async function linkedRecords(
  volunteerId: number,
  dataModel: DataModel = schemaDataModel(),
): Promise<Record<string, Record<string, Row[]>>> {
  const links = userLinks(dataModel).filter((l) => EXPORTED_LINKS.includes(l.name))
  const rows = await Promise.all(
    links.map((l) => delegateFor(l.model).findMany({ where: { [l.foreignKey]: volunteerId } })),
  )
  const records: Record<string, Record<string, Row[]>> = {}
  links.forEach((l, i) => {
    const field = l.name.slice(l.model.length + 1)
    records[l.model] ??= {}
    records[l.model][field] = rows[i].map((r) => withoutSecrets(l.model, r))
  })
  return records
}

/** The person's own account row, every column but the secrets. */
export async function exportProfile(volunteerId: number) {
  const vol = await prisma.volunteer.findUnique({
    where: { id: volunteerId },
    include: {
      group: { select: { name: true } },
      chapter: { select: { name: true } },
      skills: { include: { skill: { include: { category: true } } } },
    },
  })
  if (!vol) return null
  const { group, chapter, skills, ...columns } = vol
  const skillsData = skills.map((vs) => ({
    id: vs.skill.id,
    categoryId: vs.skill.categoryId,
    name: vs.skill.name,
    description: vs.skill.description,
    sortOrder: vs.skill.sortOrder,
    createdAt: vs.skill.createdAt,
    categoryName: vs.skill.category.name,
    proficiencyLevel: vs.proficiencyLevel,
  }))
  return {
    profile: {
      ...withoutSecrets(USER_MODEL, columns),
      localGroup: group?.name ?? null,
      nationalChapter: chapter?.name ?? null,
      isSuperAdmin: isSuperAdmin(vol),
      hasPassword: Boolean(vol.passwordHash),
      skills: skillsData,
    },
    skills: skillsData,
  }
}
