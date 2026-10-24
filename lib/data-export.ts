import type { RuntimeDataModel } from '@prisma/client/runtime/library'
import { prisma } from '@/lib/prisma'
import { hashEmail, isSuperAdmin } from '@/lib/auth'
import type { Volunteer } from '@/generated/prisma/client'

/**
 * The data-subject export (GDPR Articles 15 and 20), built from the Prisma schema. Every way a row
 * points at a person is a link, and classificationProblems fails until each is exported or omitted.
 */

export type DataModel = Pick<RuntimeDataModel, 'models'>
type Row = Record<string, unknown>

const USER_MODEL = 'Volunteer'
/** The outreach tool's own account: a volunteer holds the one with their confirmed address. */
const PARTICIPANT_MODEL = 'ExperimentalOutreachParticipant'

/**
 * One way a row of `model` points at a person, named `Model.field` after the relation field or
 * column: by their id, their email address, the SHA-256 of their normalised address, or their
 * outreach participant account.
 */
export interface UserLink {
  name: string
  model: string
  foreignKey: string
  matchBy: 'id' | 'email' | 'emailHash' | 'participant'
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
  'AdminInvite.email',
  'AdminNote.volunteer',
  'AnonymisedEmail.emailHash',
  'ApiToken.volunteer',
  'BugReport.reporter',
  'BugReport.reporterEmail',
  'BugReportComment.author',
  'ChapterAuditEvent.targetVolunteer',
  'ChapterDeputy.volunteer',
  'ChapterTransferRequest.volunteer',
  'ContactRequest.from',
  'ContactRequest.to',
  'DeletionRequest.volunteerEmail',
  'DeletionRequest.volunteerId',
  'DistinctAccountPair.volunteerA',
  'DistinctAccountPair.volunteerB',
  'EmailVerificationToken.volunteer',
  'ExperimentalJournalist.claimedBy',
  'ExperimentalJournalist.contactedBy',
  'ExperimentalJournalist.email',
  'ExperimentalOutreachLoginToken.participant',
  'ExperimentalOutreachParticipant.email',
  'ExperimentalOutreachSession.participant',
  'FinishByReminder.recipient',
  'LocalGroupSuggestion.suggestedBy',
  'Message.from',
  'Message.to',
  'NationalChapter.lead',
  'Notification.volunteer',
  'PasswordResetToken.volunteer',
  'ProjectDeputy.volunteer',
  'RejectedApplication.emailHash',
  'Session.volunteer',
  'SkillEndorsement.volunteer',
  'TeamJoinRequest.volunteer',
  'TeamMembership.volunteer',
  'TeamSuggestion.suggestedBy',
  'Template.createdBy',
  'Volunteer.mergedInto',
  'WorkItem.assignee',
  'WorkItem.creator',
  'WorkItem.requestedBy',
  'WorkItem.stakeholder',
  'WorkItemComment.author',
  'WorkItemDependency.createdBy',
  'WorkItemEvent.actor',
  'WorkItemInterest.volunteer',
]

/**
 * Links whose rows are someone else's record, exported as only the columns about this person.
 * A journalist's name, address and notes are the journalist's data.
 */
export const EXPORTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  'ExperimentalJournalist.claimedBy': ['id', 'claimedById', 'claimedAt'],
  'ExperimentalJournalist.contactedBy': ['id', 'contactedById', 'contactedAt', 'sentLeaning'],
}

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
  'Volunteer.duplicateOf':
    "an admin's guess at the same person, until both accounts confirm a merge",
  'Volunteer.reviewer': 'applications reviewed for other people',
  'VolunteerSkill.volunteer': 'exported as `skills`',
  'WorkItem.reviewedBy': STAFF_ACTION,
  'WorkItemInterest.invitedBy': 'invites to other people',
}

/** Columns never exported: credentials, the tokens that stand in for them, and hashes. */
export const SECRET_FIELDS: Readonly<Record<string, readonly string[]>> = {
  AccountMergeRequest: ['token'],
  AdminInvite: ['inviteToken'],
  AnonymisedEmail: ['emailHash'],
  ApiToken: ['tokenHash'],
  EmailVerificationToken: ['token'],
  ExperimentalOutreachLoginToken: ['tokenHash'],
  ExperimentalOutreachSession: ['tokenHash'],
  PasswordResetToken: ['token'],
  RejectedApplication: ['emailHash'],
  Session: ['tokenHash'],
  Volunteer: ['authToken', 'authTokenExpiresAt', 'passwordHash'],
}

/** Columns whose names look secret but hold nothing that is: exported as they are. */
export const PLAIN_FIELDS: Readonly<Record<string, readonly string[]>> = {}

const SECRET_LOOKING = /token|hash|password|secret|key|code|otp/i
const PERSON_ID = /^(v|.+V)olunteerId$/
const EMAIL = /^(e|.+E)mail$/
const EMAIL_HASH = /^(e|.+E)mailHash$/

/**
 * Every link to a person in the schema: owning relation fields to Volunteer or to an outreach
 * participant, a bare `volunteerId`-style column with no relation, and an email or email-hash
 * column outside the account itself.
 */
export function userLinks(dataModel: DataModel): UserLink[] {
  const links: UserLink[] = []
  for (const [model, { fields }] of Object.entries(dataModel.models)) {
    const relationKeys = new Set(fields.flatMap((f) => f.relationFromFields ?? []))
    const link = (field: string, foreignKey: string, matchBy: UserLink['matchBy']) =>
      links.push({ name: `${model}.${field}`, model, foreignKey, matchBy })
    for (const f of fields) {
      if (f.kind === 'object' && f.type === USER_MODEL && f.relationFromFields?.length) {
        link(f.name, f.relationFromFields[0], 'id')
      } else if (
        f.kind === 'object' &&
        f.type === PARTICIPANT_MODEL &&
        f.relationFromFields?.length
      ) {
        link(f.name, f.relationFromFields[0], 'participant')
      } else if (f.kind !== 'scalar' || relationKeys.has(f.name)) {
        continue
      } else if (PERSON_ID.test(f.name)) {
        link(f.name, f.name, 'id')
      } else if (model !== USER_MODEL && EMAIL.test(f.name)) {
        link(f.name, f.name, 'email')
      } else if (model !== USER_MODEL && EMAIL_HASH.test(f.name)) {
        link(f.name, f.name, 'emailHash')
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
    const declared = [...(SECRET_FIELDS[model] ?? []), ...(PLAIN_FIELDS[model] ?? [])]
    for (const { name: field } of columns) {
      if (SECRET_LOOKING.test(field) && !declared.includes(field))
        problems.push(
          `${model}.${field} looks secret but is in neither SECRET_FIELDS nor PLAIN_FIELDS`,
        )
    }
  }
  for (const [link, columns] of Object.entries(EXPORTED_COLUMNS)) {
    const [model] = link.split('.')
    const fields = dataModel.models[model]?.fields.map((f) => f.name) ?? []
    for (const column of columns) {
      if (!fields.includes(column))
        problems.push(`EXPORTED_COLUMNS names ${model}.${column}, which is not in the schema`)
    }
  }
  for (const [list, byModel] of Object.entries({ SECRET_FIELDS, PLAIN_FIELDS })) {
    for (const [model, named] of Object.entries(byModel)) {
      const fields = dataModel.models[model]?.fields.map((f) => f.name) ?? []
      for (const field of named) {
        if (!fields.includes(field))
          problems.push(`${list} names ${model}.${field}, which is not in the schema`)
      }
    }
  }
  return problems
}

/** The schema as the generated client holds it; the `prisma-client` generator exports no `Prisma.dmmf`. */
export function schemaDataModel(): DataModel {
  const dataModel = (prisma as unknown as { _runtimeDataModel?: DataModel })._runtimeDataModel
  if (!dataModel?.models) {
    throw new Error('The Prisma client no longer exposes _runtimeDataModel; see lib/data-export.ts')
  }
  return dataModel
}

function withoutSecrets(model: string, row: Row): Row {
  const secrets = SECRET_FIELDS[model] ?? []
  return Object.fromEntries(Object.entries(row).filter(([k]) => !secrets.includes(k)))
}

type Delegate = {
  findMany(args: { where: Row; select?: Record<string, true> }): Promise<Row[]>
}

function delegateFor(model: string): Delegate {
  const key = model[0].toLowerCase() + model.slice(1)
  const delegate = (prisma as unknown as Record<string, Delegate | undefined>)[key]
  if (!delegate) throw new Error(`The Prisma client has no delegate for ${model}`)
  return delegate
}

/** How many of one export's queries run at once, so an export never holds the whole pool. */
const QUERIES_AT_ONCE = 4

/** The person an export is for. Their address counts only once confirmed: anyone can type one in. */
export type ExportSubject = Pick<Volunteer, 'id' | 'email' | 'emailConfirmed'>

/**
 * Every exported link's rows for one person, as `{ Model: { link: rows } }`, so a row is filed
 * under how it points at them (`Message.from` is what they sent, `Message.to` what they received).
 */
export async function linkedRecords(
  subject: ExportSubject,
  dataModel: DataModel = schemaDataModel(),
): Promise<Record<string, Record<string, Row[]>>> {
  const links = userLinks(dataModel).filter((l) => EXPORTED_LINKS.includes(l.name))
  const email = subject.emailConfirmed ? subject.email : null
  const byAddress = email ? { equals: email.trim(), mode: 'insensitive' as const } : null
  const participants = byAddress
    ? await prisma.experimentalOutreachParticipant.findMany({
        where: { email: byAddress },
        select: { id: true },
      })
    : []
  const matching = (l: UserLink): Row | null => {
    if (l.matchBy === 'id') return { [l.foreignKey]: subject.id }
    if (email === null) return null
    if (l.matchBy === 'emailHash') return { [l.foreignKey]: hashEmail(email) }
    if (l.matchBy === 'participant')
      return { [l.foreignKey]: { in: participants.map((p) => p.id) } }
    return { [l.foreignKey]: byAddress }
  }
  const rows: Row[][] = []
  for (let i = 0; i < links.length; i += QUERIES_AT_ONCE) {
    const batch = links.slice(i, i + QUERIES_AT_ONCE).map((l) => {
      const where = matching(l)
      if (!where) return Promise.resolve([])
      const columns = EXPORTED_COLUMNS[l.name]
      const select = columns && Object.fromEntries(columns.map((c) => [c, true as const]))
      return delegateFor(l.model).findMany({ where, select })
    })
    rows.push(...(await Promise.all(batch)))
  }
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
    },
    skills: skillsData,
  }
}
