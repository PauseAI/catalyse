import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { createAdmin, createVolunteer } from '@/test/factories'
import { categoryOf } from './notification-categories'
import { NOTIFICATION_TYPES, defaultDelivery, isFixed } from './notification-types'

const dir = join(process.cwd(), 'prisma', 'migrations')
const migration = readFileSync(
  join(
    dir,
    readdirSync(dir).find((d) => d.endsWith('_notification_preferences'))!,
    'migration.sql',
  ),
  'utf8',
)
const copy = migration.slice(
  migration.indexOf('-- BEGIN muted categories'),
  migration.indexOf('-- END muted categories'),
)

/** Emails that went out directly, never through the mute, so muting kept them coming. */
const NEVER_MUTED = ['local_group_suggestion_reviewed', 'account_deleted_impact']

describe('migrating muted categories', () => {
  it('names every type a muted category stopped emailing', () => {
    const listed = [...copy.matchAll(/\('(\w+)', '(\w+)', (true|false)\)/g)].map((m) => [
      m[1],
      m[2],
    ])
    const expected = NOTIFICATION_TYPES.filter(
      (t) =>
        !isFixed(t) &&
        !NEVER_MUTED.includes(t) &&
        categoryOf(t) !== 'message' &&
        defaultDelivery(t, { isTechnicalAdmin: true }) === 'email',
    ).map((t) => [categoryOf(t), t])
    expect(listed.sort()).toEqual(expected.sort())
  })

  it('turns a muted category into In app for its emailing types, and leaves others alone', async () => {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "volunteers" ADD COLUMN "email_muted_categories" TEXT[] NOT NULL DEFAULT '{}'`,
    )
    const updates = await createVolunteer()
    const both = await createVolunteer()
    const tech = await createAdmin({ isTechnicalAdmin: true })
    const plainAdmin = await createAdmin()
    const nobody = await createVolunteer()
    const mute = (id: number, categories: string[]) =>
      prisma.$executeRawUnsafe(
        `UPDATE "volunteers" SET "email_muted_categories" = $1 WHERE id = $2`,
        categories,
        id,
      )
    await mute(updates.id, ['update'])
    await mute(both.id, ['needs_action', 'update'])
    await mute(tech.id, ['needs_action'])
    await mute(plainAdmin.id, ['needs_action'])
    // Already chosen: the copy keeps it.
    await prisma.notificationPreference.create({
      data: { volunteerId: updates.id, type: 'comment_reply', delivery: 'digest' },
    })

    await prisma.$executeRawUnsafe(copy)
    await prisma.$executeRawUnsafe(`ALTER TABLE "volunteers" DROP COLUMN "email_muted_categories"`)

    const of = async (id: number) =>
      Object.fromEntries(
        (await prisma.notificationPreference.findMany({ where: { volunteerId: id } })).map((p) => [
          p.type,
          p.delivery,
        ]),
      )
    const mine = await of(updates.id)
    expect(mine).toMatchObject({ project_approved: 'in_app', comment_reply: 'digest' })
    expect(mine.new_interest).toBeUndefined()
    expect(mine.local_group_suggestion_reviewed).toBeUndefined()
    expect(await of(both.id)).toMatchObject({ new_interest: 'in_app', task_assigned: 'in_app' })
    expect(await of(tech.id)).toMatchObject({ new_bug_report: 'in_app', new_interest: 'in_app' })
    expect((await of(plainAdmin.id)).new_bug_report).toBeUndefined()
    expect(await of(nobody.id)).toEqual({})
  })
})
