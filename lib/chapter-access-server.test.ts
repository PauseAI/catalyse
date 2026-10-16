import { describe, expect, it } from 'vitest'
import { prisma } from './prisma'
import {
  chapterFilter,
  chapterStaffIds,
  globalAdminWhere,
  loadAccess,
} from './chapter-access-server'
import {
  createAdmin,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createMember,
  createSuperAdmin,
  createVolunteer,
} from '@/test/factories'

describe('loadAccess', () => {
  it('reads the role a person holds in their own chapter', async () => {
    const chapter = await createChapter()
    const lead = await createChapterLead(chapter)
    const deputy = await createChapterDeputy(chapter)
    const member = await createMember(chapter)

    expect(await loadAccess(lead)).toEqual({
      globalAdmin: false,
      chapterId: chapter.id,
      role: 'LEAD',
    })
    expect(await loadAccess(deputy)).toMatchObject({ role: 'DEPUTY' })
    expect(await loadAccess(member)).toEqual({
      globalAdmin: false,
      chapterId: chapter.id,
      role: null,
    })
    expect(await loadAccess(await createVolunteer())).toEqual({
      globalAdmin: false,
      chapterId: null,
      role: null,
    })
    expect(await loadAccess(null)).toEqual({ globalAdmin: false, chapterId: null, role: null })
  })

  it('grants nothing for a role in a chapter the person has left', async () => {
    const [home, away] = [await createChapter(), await createChapter()]
    const lead = await createChapterLead(home)
    const deputy = await createChapterDeputy(home)
    await prisma.volunteer.updateMany({
      where: { id: { in: [lead.id, deputy.id] } },
      data: { nationalChapterId: away.id },
    })
    expect(await loadAccess(lead)).toEqual({ globalAdmin: false, chapterId: away.id, role: null })
    expect((await loadAccess(deputy)).role).toBeNull()
  })

  it('counts only an admin listed in ADMIN_EMAILS as a global admin', async () => {
    expect((await loadAccess(await createSuperAdmin())).globalAdmin).toBe(true)
    expect((await loadAccess(await createAdmin())).globalAdmin).toBe(false)
  })
})

describe('chapterFilter', () => {
  const member = { globalAdmin: false, chapterId: 3, role: null }
  const global = { globalAdmin: true, chapterId: null, role: null }

  it('holds everyone but a global admin to their own chapter', () => {
    expect(chapterFilter(member)).toBe(3)
    expect(chapterFilter(member, 9)).toBe(3)
    expect(chapterFilter(member, 'pool')).toBe(3)
  })

  it('gives a global admin the chapter, the pool, or everything they ask for', () => {
    expect(chapterFilter(global, 9)).toBe(9)
    expect(chapterFilter(global, 'pool')).toBeNull()
    expect(chapterFilter(global)).toBeUndefined()
  })
})

describe('chapterStaffIds', () => {
  it('lists the lead and deputies who still have accounts', async () => {
    const chapter = await createChapter()
    const lead = await createChapterLead(chapter)
    const deputy = await createChapterDeputy(chapter)
    const gone = await createChapterDeputy(chapter, { deletedAt: new Date() })
    await createMember(chapter)

    const ids = await chapterStaffIds(chapter.id)
    expect(ids.sort()).toEqual([lead.id, deputy.id].sort())
    expect(ids).not.toContain(gone.id)
    expect(await chapterStaffIds((await createChapter()).id)).toEqual([])
  })
})

describe('globalAdminWhere', () => {
  it('matches confirmed, live accounts listed in ADMIN_EMAILS, whatever their case', async () => {
    const listed = await createSuperAdmin()
    const shouting = await createVolunteer({ email: 'ADMIN19@EXAMPLE.COM' })
    const unconfirmed = await createVolunteer({
      email: 'admin18@example.com',
      emailConfirmed: false,
    })
    const deleted = await createVolunteer({ email: 'admin17@example.com', deletedAt: new Date() })
    const unlisted = await createAdmin()

    const ids = (await prisma.volunteer.findMany({ where: globalAdminWhere() })).map((v) => v.id)
    expect(ids).toEqual(expect.arrayContaining([listed.id, shouting.id]))
    for (const v of [unconfirmed, deleted, unlisted]) expect(ids).not.toContain(v.id)
  })
})
