import { describe, it, expect } from 'vitest'
import { Client } from 'pg'
import { prisma } from '@/lib/prisma'
import { resolveDbUrl } from '@/lib/db-url'
import { createVolunteer, createAdmin, createProject, createStaffInvite } from '@/test/factories'
import { createSession } from '@/lib/auth'
import { libpqUrl } from '../jobs/backup'
import { COLUMN_TREATMENT, REDACTED } from './anonymise-columns'
import { anonymise } from './anonymise-db'

/** A pg client on this test file's own schema, which is what the anonymiser is handed. */
async function withSchemaClient<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const url = new URL(resolveDbUrl())
  const db = new Client({ connectionString: libpqUrl(url.toString()) })
  await db.connect()
  try {
    await db.query(`SET search_path TO "${url.searchParams.get('schema')}"`)
    return await fn(db)
  } finally {
    await db.end()
  }
}

describe('anonymiser column map', () => {
  it('classifies every text column in the schema, and names none that do not exist', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND data_type IN ('text', 'character varying', 'json', 'jsonb')`
    const inSchema = rows.map((r) => `${r.table_name}.${r.column_name}`).sort()
    const inMap = Object.entries(COLUMN_TREATMENT)
      .flatMap(([table, columns]) => Object.keys(columns).map((column) => `${table}.${column}`))
      .sort()
    expect(inMap).toEqual(inSchema)
  })
})

describe('anonymise', () => {
  it('leaves nothing a person typed, and nothing that signs anyone in', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer({
      name: 'Real Person',
      email: 'real.person@example.org',
      applicationMessage: 'I live at 1 Real Street',
      applicationAdminNotes: 'Met them at the protest',
    })
    await createSession(vol.id)
    const project = await createProject({ reviewNotes: 'Proposer seemed unsure', title: 'Kept' })
    await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: vol.id,
        interestType: 'want_to_help',
        message: 'Call me on 07700 900000',
      },
    })
    await prisma.emailVerificationToken.create({
      data: { volunteerId: vol.id, token: 'live-verify', expiresAt: new Date(Date.now() + 60_000) },
    })
    await prisma.passwordResetToken.create({
      data: { volunteerId: vol.id, token: 'live-reset', expiresAt: new Date(Date.now() + 60_000) },
    })
    await createStaffInvite({
      email: 'invited.person@example.org',
      inviteToken: 'live-invite',
      invitedById: admin.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const journalist = await prisma.experimentalJournalist.create({
      data: {
        firstName: 'Lois',
        lastName: 'Lane',
        email: 'lois@planet.com',
        organisation: 'Daily Planet',
        leaning: 'DEMOCRAT',
        website: 'https://planet.com/lois',
        notes: 'Prefers phone',
      },
    })
    const participant = await prisma.experimentalOutreachParticipant.create({
      data: { email: 'real.participant@example.org' },
    })
    await prisma.experimentalOutreachSession.create({
      data: {
        participantId: participant.id,
        tokenHash: 'live-outreach-session',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    await withSchemaClient(anonymise)

    const after = await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })
    expect(after.name).not.toBe('Real Person')
    expect(after.email).not.toBe('real.person@example.org')
    expect(after).toMatchObject({
      applicationMessage: REDACTED,
      applicationAdminNotes: REDACTED,
      applicationApplicantNotes: null,
    })
    expect(await prisma.session.count()).toBe(0)
    expect(await prisma.emailVerificationToken.count()).toBe(0)
    expect(await prisma.experimentalOutreachSession.count()).toBe(0)
    expect((await prisma.passwordResetToken.findFirstOrThrow()).token).not.toBe('live-reset')
    const invite = await prisma.adminInvite.findFirstOrThrow()
    expect(invite.inviteToken).not.toBe('live-invite')
    expect(invite.email).not.toBe('invited.person@example.org')

    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({
      title: 'Kept',
      reviewNotes: REDACTED,
    })
    expect((await prisma.workItemInterest.findFirstOrThrow()).message).toBe(REDACTED)
    expect(
      await prisma.experimentalJournalist.findUniqueOrThrow({ where: { id: journalist.id } }),
    ).toMatchObject({
      email: `journalist${journalist.id}@example.com`,
      website: null,
      notes: REDACTED,
      interests: null,
    })
    expect(
      (
        await prisma.experimentalOutreachParticipant.findUniqueOrThrow({
          where: { id: participant.id },
        })
      ).email,
    ).toBe(`participant${participant.id}@example.com`)
  })

  it('skips columns the restored dump does not have yet', async () => {
    await withSchemaClient(async (db) => {
      await db.query('ALTER TABLE work_items DROP COLUMN outcome_notes')
      await expect(anonymise(db)).resolves.toBeUndefined()
    })
  })
})
