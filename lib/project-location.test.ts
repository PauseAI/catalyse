import { describe, expect, it } from 'vitest'
import { createChapter, createLocalGroup } from '@/test/factories'
import { projectLocation } from './project-location'

const member = (chapterId: number | null) => ({ globalAdmin: false, chapterId, role: null })
const global = { globalAdmin: true, chapterId: null, role: null }

describe('projectLocation', () => {
  it("puts a new project in its creator's chapter, country-wide unless asked", async () => {
    const chapter = await createChapter()
    expect(await projectLocation(member(chapter.id), {})).toEqual({
      nationalChapterId: chapter.id,
      reach: 'COUNTRY_WIDE',
      localGroupId: null,
      chapterChanged: false,
    })
    expect(await projectLocation(member(null), { reach: 'REMOTE' })).toMatchObject({
      nationalChapterId: null,
      reach: 'REMOTE',
    })
  })

  it("makes a local project name one of its own chapter's groups", async () => {
    const chapter = await createChapter()
    const other = await createChapter()
    const group = await createLocalGroup({
      country: chapter.country,
      nationalChapterId: chapter.id,
    })
    const elsewhere = await createLocalGroup({
      country: other.country,
      nationalChapterId: other.id,
    })
    const access = member(chapter.id)
    expect(await projectLocation(access, { reach: 'LOCAL', localGroupId: group.id })).toMatchObject(
      { reach: 'LOCAL', localGroupId: group.id },
    )
    const refused = { message: "A local project needs one of its chapter's local groups" }
    await expect(projectLocation(access, { reach: 'LOCAL' })).rejects.toMatchObject(refused)
    await expect(
      projectLocation(access, { reach: 'LOCAL', localGroupId: elsewhere.id }),
    ).rejects.toMatchObject(refused)
    await expect(
      projectLocation(access, { reach: 'LOCAL', localGroupId: 999_999 }),
    ).rejects.toMatchObject(refused)
    // A group left on a project stays when only something else changes.
    const current = {
      nationalChapterId: chapter.id,
      reach: 'LOCAL' as const,
      localGroupId: group.id,
    }
    expect(await projectLocation(access, {}, current)).toMatchObject({ localGroupId: group.id })
  })

  it('lets only a global admin move a project, and a moved local one becomes country-wide', async () => {
    const [from, to] = [await createChapter(), await createChapter()]
    const group = await createLocalGroup({ country: from.country, nationalChapterId: from.id })
    const current = { nationalChapterId: from.id, reach: 'LOCAL' as const, localGroupId: group.id }
    await expect(
      projectLocation(member(from.id), { chapterId: to.id }, current),
    ).rejects.toMatchObject({ message: 'Only a global admin moves a project to another chapter' })
    expect(await projectLocation(global, { chapterId: to.id }, current)).toEqual({
      nationalChapterId: to.id,
      reach: 'COUNTRY_WIDE',
      localGroupId: null,
      chapterChanged: true,
    })
    expect(
      await projectLocation(global, { chapterId: null }, { ...current, reach: 'REMOTE' }),
    ).toMatchObject({ nationalChapterId: null, reach: 'REMOTE', chapterChanged: true })
    await expect(projectLocation(global, { chapterId: 999_999 }, current)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    // A global admin creates straight into any chapter.
    expect(await projectLocation(global, { chapterId: to.id })).toMatchObject({
      nationalChapterId: to.id,
      chapterChanged: false,
    })
  })
})
