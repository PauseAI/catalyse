import { describe, it, expect } from 'vitest'
import {
  EXPORTED_LINKS,
  OMITTED_LINKS,
  classificationProblems,
  emailHash,
  exportProfile,
  linkedRecords,
  schemaDataModel,
  userLinks,
  type DataModel,
} from './data-export'
import {
  createChapter,
  createProject,
  createSkill,
  createTeam,
  createVolunteer,
  nextSeq,
} from '@/test/factories'
import { prisma } from '@/lib/prisma'

const schema = schemaDataModel()

/** The real schema with `models` changed, for trying the guard against a schema change. */
function withModels(change: (models: Record<string, unknown>) => void): DataModel {
  const models: Record<string, unknown> = structuredClone(schema.models)
  change(models)
  return { models } as DataModel
}

const relationToVolunteer = (name: string, foreignKey: string) => ({
  name,
  kind: 'object',
  type: 'Volunteer',
  relationFromFields: [foreignKey],
})
const scalar = (name: string) => ({ name, kind: 'scalar', type: 'Int' })

describe('data export classification', () => {
  it('classifies every link to a person in the schema, and declares every secret', () => {
    expect(classificationProblems(schema)).toEqual([])
  })

  it('finds links by every relation field to Volunteer, not one column name', () => {
    const names = userLinks(schema).map((l) => l.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'AdminNote.author',
        'AdminNote.volunteer',
        'BugReport.reporter',
        'BugReport.resolvedBy',
        'WorkItem.assignee',
        'Message.from',
        // A volunteer column with no relation.
        'DeletionRequest.volunteerId',
      ]),
    )
    expect(userLinks(schema).find((l) => l.name === 'Message.from')?.foreignKey).toBe(
      'fromVolunteerId',
    )
  })

  it('never both exports and omits a link', () => {
    expect(EXPORTED_LINKS.filter((l) => l in OMITTED_LINKS)).toEqual([])
  })

  it('fails on a new model that points at a person until it is classified', () => {
    const dataModel = withModels((m) => {
      m.Pledge = {
        fields: [scalar('id'), scalar('signerId'), relationToVolunteer('signer', 'signerId')],
      }
    })
    expect(classificationProblems(dataModel)).toEqual([
      'Pledge.signer is not in EXPORTED_LINKS or OMITTED_LINKS',
    ])
  })

  it('fails on a new bare volunteer column', () => {
    const dataModel = withModels((m) => {
      m.Survey = { fields: [scalar('id'), scalar('respondentVolunteerId')] }
    })
    expect(classificationProblems(dataModel)).toEqual([
      'Survey.respondentVolunteerId is not in EXPORTED_LINKS or OMITTED_LINKS',
    ])
  })

  it('fails on a new relation from an existing model', () => {
    const dataModel = withModels((m) => {
      const fields = (m.Message as { fields: unknown[] }).fields
      fields.push(scalar('forwardedById'), relationToVolunteer('forwardedBy', 'forwardedById'))
    })
    expect(classificationProblems(dataModel)).toEqual([
      'Message.forwardedBy is not in EXPORTED_LINKS or OMITTED_LINKS',
    ])
  })

  it('fails on a new email or email-hash column', () => {
    const dataModel = withModels((m) => {
      m.Petition = {
        fields: [
          scalar('id'),
          { name: 'signerEmail', kind: 'scalar', type: 'String' },
          { name: 'emailHash', kind: 'scalar', type: 'String' },
        ],
      }
    })
    expect(classificationProblems(dataModel)).toEqual([
      'Petition.signerEmail is not in EXPORTED_LINKS or OMITTED_LINKS',
      'Petition.emailHash is not in EXPORTED_LINKS or OMITTED_LINKS',
    ])
  })

  it('fails on a secret-looking column in an exported model', () => {
    const dataModel = withModels((m) => {
      ;(m.Notification as { fields: unknown[] }).fields.push({
        name: 'unsubscribeToken',
        kind: 'scalar',
        type: 'String',
      })
    })
    expect(classificationProblems(dataModel)).toEqual([
      'Notification.unsubscribeToken looks secret but is not in SECRET_FIELDS',
    ])
  })

  it('fails on a classification or secret the schema no longer has', () => {
    const dataModel = withModels((m) => {
      delete m.ContactRequest
      const session = m.Session as { fields: { name: string }[] }
      session.fields = session.fields.filter((f) => f.name !== 'tokenHash')
    })
    expect(classificationProblems(dataModel)).toEqual([
      'ContactRequest.from is classified but no longer in the schema',
      'ContactRequest.to is classified but no longer in the schema',
      'SECRET_FIELDS names Session.tokenHash, which is not in the schema',
    ])
  })
})

describe('linkedRecords', () => {
  it('files each row under every exported link, and nothing under an omitted one', async () => {
    const me = await createVolunteer()
    const records = await linkedRecords(me.id)
    const filed = Object.entries(records).flatMap(([model, links]) =>
      Object.keys(links).map((field) => `${model}.${field}`),
    )
    expect(filed.sort()).toEqual([...EXPORTED_LINKS].sort())
  })

  it('reads the rows of one person only, without their secret columns', async () => {
    const me = await createVolunteer()
    const other = await createVolunteer()
    for (const v of [me, other]) {
      await prisma.session.create({
        data: { volunteerId: v.id, tokenHash: `hash-${v.id}`, expiresAt: new Date() },
      })
    }
    const { Session } = await linkedRecords(me.id)
    expect(Session.volunteer).toEqual([expect.objectContaining({ volunteerId: me.id })])
    expect(Session.volunteer[0]).not.toHaveProperty('tokenHash')
  })
})

type Person = Awaited<ReturnType<typeof createVolunteer>>

type Row = Record<string, unknown>

/** One row for each exported link that points at `who`, with `other` wherever a second person goes. */
const rowFor: Record<string, (who: Person, other: Person) => Promise<Row>> = {
  'AccountMerge.kept': (who, other) =>
    prisma.accountMerge.create({ data: { keptId: who.id, mergedId: other.id } }),
  'AccountMerge.merged': (who, other) =>
    prisma.accountMerge.create({ data: { keptId: other.id, mergedId: who.id } }),
  'AccountMergeRequest.requester': (who, other) =>
    prisma.accountMergeRequest.create({
      data: {
        requesterId: who.id,
        otherId: other.id,
        token: `t${nextSeq()}`,
        expiresAt: new Date(),
      },
    }),
  'AccountMergeRequest.other': (who, other) =>
    prisma.accountMergeRequest.create({
      data: {
        requesterId: other.id,
        otherId: who.id,
        token: `t${nextSeq()}`,
        expiresAt: new Date(),
      },
    }),
  'AdminInvite.acceptedBy': (who, other) =>
    prisma.adminInvite.create({
      data: {
        email: `accepted${nextSeq()}@example.com`,
        inviteToken: `i${nextSeq()}`,
        invitedById: other.id,
        acceptedById: who.id,
        expiresAt: new Date(),
      },
    }),
  'AdminInvite.email': (who, other) =>
    prisma.adminInvite.create({
      data: {
        email: who.email!.toUpperCase(),
        inviteToken: `i${nextSeq()}`,
        invitedById: other.id,
        expiresAt: new Date(),
      },
    }),
  'AdminNote.volunteer': (who, other) =>
    prisma.adminNote.create({ data: { volunteerId: who.id, authorId: other.id, content: 'note' } }),
  'AnonymisedEmail.emailHash': (who) =>
    prisma.anonymisedEmail.create({ data: { emailHash: emailHash(who.email!) } }),
  'ApiToken.volunteer': (who) =>
    prisma.apiToken.create({
      data: { volunteerId: who.id, name: 'n', tokenHash: `h${nextSeq()}` },
    }),
  'BugReport.reporter': (who) =>
    prisma.bugReport.create({ data: { reporterId: who.id, title: 't', description: 'd' } }),
  'BugReport.reporterEmail': (who) =>
    prisma.bugReport.create({ data: { reporterEmail: who.email, title: 't', description: 'd' } }),
  'BugReportComment.author': async (who) => {
    const report = await prisma.bugReport.create({ data: { title: 't', description: 'd' } })
    return prisma.bugReportComment.create({
      data: { bugReportId: report.id, authorId: who.id, content: 'c' },
    })
  },
  'ChapterAuditEvent.targetVolunteer': (who, other) =>
    prisma.chapterAuditEvent.create({
      data: { action: 'LEAD_APPOINTED', actorId: other.id, targetVolunteerId: who.id },
    }),
  'ChapterDeputy.volunteer': async (who) =>
    prisma.chapterDeputy.create({
      data: { nationalChapterId: (await createChapter()).id, volunteerId: who.id },
    }),
  'ChapterTransferRequest.volunteer': (who) =>
    prisma.chapterTransferRequest.create({ data: { volunteerId: who.id, toCountry: 'FR' } }),
  'ContactRequest.from': (who, other) =>
    prisma.contactRequest.create({
      data: { fromVolunteerId: who.id, toVolunteerId: other.id, message: 'm' },
    }),
  'ContactRequest.to': (who, other) =>
    prisma.contactRequest.create({
      data: { fromVolunteerId: other.id, toVolunteerId: who.id, message: 'm' },
    }),
  'DeletionRequest.volunteerId': (who) =>
    prisma.deletionRequest.create({ data: { volunteerId: who.id } }),
  // A pair is its own key, so each gets a fresh second person rather than repeating one.
  'DistinctAccountPair.volunteerA': async (who) =>
    prisma.distinctAccountPair.create({
      data: { volunteerAId: who.id, volunteerBId: (await createVolunteer()).id },
    }),
  'DistinctAccountPair.volunteerB': async (who) =>
    prisma.distinctAccountPair.create({
      data: { volunteerAId: (await createVolunteer()).id, volunteerBId: who.id },
    }),
  'EmailVerificationToken.volunteer': (who) =>
    prisma.emailVerificationToken.create({
      data: { volunteerId: who.id, token: `e${nextSeq()}`, expiresAt: new Date() },
    }),
  'ExperimentalJournalist.email': (who) =>
    prisma.experimentalJournalist.create({
      data: {
        firstName: 'J',
        lastName: 'K',
        email: who.email!,
        organisation: 'Paper',
        leaning: 'DEMOCRAT',
      },
    }),
  'ExperimentalOutreachParticipant.email': (who) =>
    prisma.experimentalOutreachParticipant.create({ data: { email: who.email! } }),
  'FinishByReminder.recipient': async (who) =>
    prisma.finishByReminder.create({
      data: {
        workItemId: (await createProject()).id,
        stage: 'due',
        finishBy: new Date(),
        recipientId: who.id,
        sentOn: new Date(),
      },
    }),
  'LocalGroupSuggestion.suggestedBy': (who) =>
    prisma.localGroupSuggestion.create({
      data: { name: `G${nextSeq()}`, country: 'UK', suggestedById: who.id },
    }),
  'Message.from': (who, other) =>
    prisma.message.create({
      data: { fromVolunteerId: who.id, toVolunteerId: other.id, subject: 's', message: 'm' },
    }),
  'Message.to': (who, other) =>
    prisma.message.create({
      data: { fromVolunteerId: other.id, toVolunteerId: who.id, subject: 's', message: 'm' },
    }),
  'NationalChapter.lead': (who) => createChapter({ leadId: who.id }),
  'Notification.volunteer': (who) =>
    prisma.notification.create({ data: { volunteerId: who.id, type: 't', title: 't' } }),
  'PasswordResetToken.volunteer': (who) =>
    prisma.passwordResetToken.create({
      data: { volunteerId: who.id, token: `p${nextSeq()}`, expiresAt: new Date() },
    }),
  'ProjectDeputy.volunteer': async (who) =>
    prisma.projectDeputy.create({
      data: { projectId: (await createProject()).id, volunteerId: who.id },
    }),
  'RejectedApplication.emailHash': (who) =>
    prisma.rejectedApplication.create({
      data: { emailHash: emailHash(` ${who.email!.toUpperCase()} `), rejectedAt: new Date() },
    }),
  'Session.volunteer': (who) =>
    prisma.session.create({
      data: { volunteerId: who.id, tokenHash: `s${nextSeq()}`, expiresAt: new Date() },
    }),
  'SkillEndorsement.volunteer': async (who, other) =>
    prisma.skillEndorsement.create({
      data: { volunteerId: who.id, skillId: (await createSkill()).id, endorsedById: other.id },
    }),
  'TeamJoinRequest.volunteer': async (who) =>
    prisma.teamJoinRequest.create({
      data: { teamId: (await createTeam()).id, volunteerId: who.id },
    }),
  'TeamMembership.volunteer': async (who) =>
    prisma.teamMembership.create({
      data: { teamId: (await createTeam()).id, volunteerId: who.id },
    }),
  'TeamSuggestion.suggestedBy': (who) =>
    prisma.teamSuggestion.create({ data: { name: `T${nextSeq()}`, suggestedById: who.id } }),
  'Template.createdBy': (who) =>
    prisma.template.create({ data: { title: 't', structure: '{}', createdById: who.id } }),
  'WorkItem.assignee': (who) => createProject({ assigneeId: who.id }),
  'WorkItem.creator': (who) => createProject({ creatorId: who.id }),
  'WorkItem.requestedBy': (who) => createProject({ requestedById: who.id }),
  'WorkItem.stakeholder': (who) => createProject({ stakeholderId: who.id }),
  'WorkItemComment.author': async (who) =>
    prisma.workItemComment.create({
      data: { workItemId: (await createProject()).id, authorId: who.id, content: 'c' },
    }),
  'WorkItemDependency.createdBy': async (who) =>
    prisma.workItemDependency.create({
      data: {
        predecessorId: (await createProject()).id,
        successorId: (await createProject()).id,
        createdById: who.id,
      },
    }),
  'WorkItemEvent.actor': async (who) =>
    prisma.workItemEvent.create({
      data: {
        workItemId: (await createProject()).id,
        actorId: who.id,
        kind: 'k',
        before: {},
        after: {},
      },
    }),
  'WorkItemInterest.volunteer': async (who) =>
    prisma.workItemInterest.create({
      data: { volunteerId: who.id, workItemId: (await createProject()).id, interestType: 'join' },
    }),
}

describe('every exported link', () => {
  it('has a row made for it below', () => {
    expect(Object.keys(rowFor).sort()).toEqual([...EXPORTED_LINKS].sort())
  })

  it("returns the person's rows under each link, and no one else's", async () => {
    const me = await createVolunteer()
    const other = await createVolunteer()
    // A row's id, or for a pair with no id of its own, the two people it pairs.
    const key = (r: Row) => String(r.id ?? [r.volunteerAId, r.volunteerBId])
    const mine: Record<string, string> = {}
    const theirs: Record<string, string> = {}
    for (const link of EXPORTED_LINKS) {
      mine[link] = key(await rowFor[link](me, other))
      theirs[link] = key(await rowFor[link](other, me))
    }

    const records = await linkedRecords(me.id)

    for (const link of EXPORTED_LINKS) {
      const [model, field] = link.split('.')
      const ids = records[model][field].map(key)
      expect.soft(ids, link).toContain(mine[link])
      expect.soft(ids, link).not.toContain(theirs[link])
    }
  })

  it("holds another person's id where a row involves them, never their name or address", async () => {
    const me = await createVolunteer()
    const other = await createVolunteer({
      name: 'Zelda Otherperson',
      email: 'zelda@elsewhere.test',
    })
    for (const link of EXPORTED_LINKS) await rowFor[link](me, other)

    const exported = JSON.stringify({
      ...(await exportProfile(me.id)),
      records: await linkedRecords(me.id),
    })

    expect(exported).toContain(`"fromVolunteerId":${me.id},"toVolunteerId":${other.id}`)
    expect(exported).not.toMatch(/Zelda|Otherperson|zelda@elsewhere/i)
  })
})
