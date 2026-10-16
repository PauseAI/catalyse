import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createTeam,
  createLocalGroup,
  createChapter,
  createChapterLead,
  createMember,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

describe('teamSuggestions', () => {
  it('creates a suggestion, notifies admins, and lists mine with merge targets', async () => {
    const admin = await createAdmin()
    const me = await createVolunteer()
    const c = clientAs(me)
    const created = await c.teamSuggestions.create({ name: 'Ops', description: null })
    expect(created).toMatchObject({
      name: 'Ops',
      status: 'pending',
      adminNotes: null,
      mergedInto: null,
    })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { volunteerId: admin.id, type: 'team_suggestion' },
        }),
      ).toBe(1),
    )
    const team = await createTeam()
    await prisma.teamSuggestion.update({
      where: { id: created.id },
      data: { mergedIntoId: team.id },
    })
    await prisma.teamSuggestion.create({ data: { name: 'Other', suggestedById: admin.id } })
    const { suggestions } = await c.teamSuggestions.list()
    expect(suggestions).toEqual([
      expect.objectContaining({ id: created.id, mergedInto: { id: team.id, name: team.name } }),
    ])
    const withDesc = await c.teamSuggestions.create({ name: 'Two', description: 'd' })
    expect(withDesc.description).toBe('d')
  })
})

describe('localGroupSuggestions', () => {
  it('validates the country, creates, notifies, and lists mine', async () => {
    const admin = await createAdmin()
    const me = await createVolunteer()
    const c = clientAs(me)
    await expect(
      c.localGroupSuggestions.create({ name: 'X', country: 'Remote' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    const created = await c.localGroupSuggestions.create({ name: 'Leeds', country: 'UK' })
    expect(created).toMatchObject({
      name: 'Leeds',
      country: 'UK',
      status: 'pending',
      mergedInto: null,
    })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: { volunteerId: admin.id, type: 'local_group_suggestion' },
        }),
      ).toBe(1),
    )
    const group = await createLocalGroup()
    await prisma.localGroupSuggestion.update({
      where: { id: created.id },
      data: { mergedIntoId: group.id },
    })
    const { suggestions } = await c.localGroupSuggestions.list()
    expect(suggestions[0].mergedInto).toEqual({ id: group.id, name: group.name })
    expect((await clientAs(admin).localGroupSuggestions.list()).suggestions).toEqual([])
  })

  it("files a member's suggestion under their chapter and tells its staff", async () => {
    const chapter = await createChapter()
    const lead = await createChapterLead(chapter)
    const admin = await createAdmin()
    const member = await createMember(chapter)
    const created = await clientAs(member).localGroupSuggestions.create({
      name: 'Riverside',
      country: 'Other',
    })
    expect(created.country).toBe(chapter.country)
    expect(
      await prisma.localGroupSuggestion.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({ nationalChapterId: chapter.id })
    const alerted = async (id: number) =>
      prisma.notification.count({ where: { volunteerId: id, type: 'local_group_suggestion' } })
    expect(await alerted(lead.id)).toBe(1)
    expect(await alerted(admin.id)).toBe(0)
  })
})

describe('admin.notes', () => {
  it('creates, lists, updates and deletes notes about a volunteer', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer()
    const c = clientAs(admin)
    await expect(
      c.admin.notes.create({ volunteerId: 999_999, content: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const { id } = await c.admin.notes.create({ volunteerId: vol.id, content: '  hello  ' })
    await c.admin.notes.create({
      volunteerId: vol.id,
      content: 'second',
      category: 'warning',
      relatedWorkItemId: null,
    })
    const notes = await c.admin.notes.listForVolunteer({ volunteerId: vol.id })
    expect(notes).toHaveLength(2)
    expect(notes.find((n) => n.id === id)).toMatchObject({
      content: 'hello',
      category: 'general',
      authorName: admin.name,
      relatedProjectId: null,
    })
    expect(await c.admin.notes.update({ id, content: 'edited', category: 'praise' })).toEqual({
      message: 'Note updated',
    })
    await c.admin.notes.update({ id })
    expect(await prisma.adminNote.findUniqueOrThrow({ where: { id } })).toMatchObject({
      content: 'edited',
      category: 'praise',
    })
    await expect(c.admin.notes.update({ id: 999_999 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await c.admin.notes.delete({ id })).toEqual({ message: 'Note deleted' })
    await expect(c.admin.notes.delete({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
