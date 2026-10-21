import { describe, it, expect } from 'vitest'
import {
  EXPORTED_LINKS,
  OMITTED_LINKS,
  classificationProblems,
  linkedRecords,
  schemaDataModel,
  userLinks,
  type DataModel,
} from './data-export'
import { createVolunteer } from '@/test/factories'
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
