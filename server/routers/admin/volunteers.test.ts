import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createProject,
  createQuickTask,
  createSkill,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createMember,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

describe('admin.volunteers', () => {
  it('getById returns the full admin view of a volunteer', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    await expect(c.admin.volunteers.getById({ id: 999_999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })

    const skill = await createSkill()
    const vol = await createVolunteer({
      skills: { create: [{ skillId: skill.id, proficiencyLevel: 'pro' }] },
    })
    await c.admin.notes.create({ volunteerId: vol.id, content: 'a note' })
    await c.admin.volunteers.addEndorsement({
      volunteerId: vol.id,
      skillId: skill.id,
      notes: 'great',
    })
    const project = await createProject({ assigneeId: vol.id })
    await createQuickTask({ assigneeId: vol.id, skillId: skill.id })
    await createQuickTask({ assigneeId: vol.id })

    const view = await c.admin.volunteers.getById({ id: vol.id })
    expect(view.email).toBe(vol.email)
    expect(view.skills).toEqual([
      expect.objectContaining({ id: skill.id, proficiencyLevel: 'pro' }),
    ])
    expect(view.adminNotes).toEqual([
      expect.objectContaining({ content: 'a note', authorName: admin.name }),
    ])
    expect(view.endorsements).toEqual([
      expect.objectContaining({
        skillName: skill.name,
        endorsedByName: admin.name,
        notes: 'great',
        rating: 'verified',
      }),
    ])
    expect(view.quickTasks.map((t) => t.skillName).sort()).toEqual([null, skill.name].sort())
    expect(view.projectHistory).toEqual([
      expect.objectContaining({ id: project.id, ownerId: vol.id }),
    ])
  })

  it('lists and upserts endorsements', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const skill = await createSkill()
    const vol = await createVolunteer()
    expect(await c.admin.volunteers.listEndorsements({ volunteerId: vol.id })).toEqual([])
    expect(
      await c.admin.volunteers.addEndorsement({ volunteerId: vol.id, skillId: skill.id }),
    ).toEqual({ message: 'Skill endorsed' })
    await c.admin.volunteers.addEndorsement({
      volunteerId: vol.id,
      skillId: skill.id,
      rating: 'strong',
      source: 'quick_task',
      sourceId: 5,
      notes: 'n',
    })
    const list = await c.admin.volunteers.listEndorsements({ volunteerId: vol.id })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      rating: 'strong',
      source: 'quick_task',
      sourceId: 5,
      notes: 'n',
      skillCategory: expect.any(String),
    })
    expect(await prisma.skillEndorsement.count({ where: { volunteerId: vol.id } })).toBe(1)
  })
})

describe('admin.volunteers.markDuplicate', () => {
  it('links a second account to the one kept, hides it, and notes it on both', async () => {
    const admin = await createAdmin()
    const c = clientAs(admin)
    const kept = await createVolunteer({ name: 'Sam Twin', email: 'sam-new@example.com' })
    const old = await createVolunteer({ name: 'Sam Twin', email: 'sam-old@example.com' })
    const noEmail = await createVolunteer({ name: 'Sam Noemail', email: null })

    expect(await c.admin.volunteers.markDuplicate({ id: old.id, duplicateOfId: kept.id })).toEqual({
      message: 'Sam Twin is marked as a duplicate of Sam Twin',
    })
    await c.admin.volunteers.markDuplicate({ id: noEmail.id, duplicateOfId: kept.id })

    const keptView = await c.admin.volunteers.getById({ id: kept.id })
    expect(keptView.duplicateOf).toBeNull()
    expect(keptView.duplicates.map((d) => d.id).sort()).toEqual([old.id, noEmail.id].sort())
    expect(keptView.adminNotes.map((n) => n.content)).toEqual(
      expect.arrayContaining([
        'Sam Twin (sam-old@example.com) marked as a duplicate of this account.',
        'Sam Noemail marked as a duplicate of this account.',
      ]),
    )
    const oldView = await c.admin.volunteers.getById({ id: old.id })
    expect(oldView.duplicateOf).toEqual({ id: kept.id, name: 'Sam Twin', email: kept.email })
    expect(oldView.adminNotes[0].content).toBe(
      'Marked as a duplicate of Sam Twin (sam-new@example.com).',
    )

    // Out of the directory, and so out of every picker that searches it.
    const listed = (await c.volunteers.list({ search: 'Sam' })).volunteers.map((v) => v.id)
    expect(listed).toContain(kept.id)
    expect(listed).not.toContain(old.id)
    expect((await c.volunteers.getById({ id: old.id })).duplicateOf).toEqual({
      id: kept.id,
      name: 'Sam Twin',
    })

    // A third account becomes the keeper, and the marks follow it.
    const newest = await createVolunteer({ name: 'Sam Newest' })
    await c.admin.volunteers.markDuplicate({ id: kept.id, duplicateOfId: newest.id })
    expect(
      (await c.admin.volunteers.getById({ id: newest.id })).duplicates.map((d) => d.id).sort(),
    ).toEqual([kept.id, old.id, noEmail.id].sort())

    expect(await c.admin.volunteers.markDuplicate({ id: old.id, duplicateOfId: null })).toEqual({
      message: 'Sam Twin is no longer marked as a duplicate',
    })
    const cleared = await c.admin.volunteers.getById({ id: old.id })
    expect(cleared.duplicateOf).toBeNull()
    expect(cleared.adminNotes[0].content).toBe('No longer marked as a duplicate.')
  })

  it('refuses a mark that would chain, loop, or leave a chapter role on a duplicate', async () => {
    const c = clientAs(await createAdmin())
    const chapter = await createChapter({ name: 'Ruritania' })
    const lead = await createChapterLead(chapter, { name: 'Lee Lead' })
    const deputy = await createChapterDeputy(chapter, { name: 'Dee Deputy' })
    const kept = await createMember(chapter, { name: 'Kim Kept' })
    const old = await createMember(chapter, { name: 'Kim Old' })
    await c.admin.volunteers.markDuplicate({ id: old.id, duplicateOfId: kept.id })

    const refused = (id: number, duplicateOfId: number | null) =>
      expect(c.admin.volunteers.markDuplicate({ id, duplicateOfId })).rejects
    await refused(kept.id, kept.id).toMatchObject({
      message: 'An account cannot be a duplicate of itself',
    })
    await refused(kept.id, null).toMatchObject({ message: 'Kim Kept is not marked as a duplicate' })
    await refused(lead.id, old.id).toMatchObject({
      message: 'Kim Old is itself marked as a duplicate',
    })
    await refused(999_999, kept.id).toMatchObject({ code: 'NOT_FOUND' })
    await refused(kept.id, 999_999).toMatchObject({ code: 'NOT_FOUND' })
    await refused(lead.id, kept.id).toMatchObject({
      message:
        'Lee Lead leads the Ruritania chapter. Give the role to the account you are keeping first.',
    })
    await refused(deputy.id, kept.id).toMatchObject({
      message:
        'Dee Deputy is a deputy of the Ruritania chapter. Give the role to the account you are keeping first.',
    })

    // Nor is a duplicate given a role.
    await expect(
      c.admin.chapters.appointLead({ chapterId: chapter.id, volunteerId: old.id }),
    ).rejects.toMatchObject({
      message: 'Kim Old is a duplicate account. Appoint Kim Kept instead.',
    })
    await expect(
      clientAs(lead).admin.chapters.appointDeputy({ chapterId: chapter.id, volunteerId: old.id }),
    ).rejects.toMatchObject({
      message: 'Kim Old is a duplicate account. Appoint Kim Kept instead.',
    })
    const members = (await c.admin.chapters.get({ chapterId: chapter.id })).members
    expect(members.find((m) => m.id === old.id)?.duplicateOf).toEqual({
      id: kept.id,
      name: 'Kim Kept',
    })

    // Only a global admin marks accounts.
    await expect(
      clientAs(lead).admin.volunteers.markDuplicate({ id: kept.id, duplicateOfId: null }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('admin.emailPreview', () => {
  it('lists every registered preview and renders each', async () => {
    const c = clientAs(await createAdmin())
    const { types } = await c.admin.emailPreview.types()
    expect(types.length).toBeGreaterThan(10)
    for (const type of types) {
      const { subject, html } = await c.admin.emailPreview.preview({ type })
      expect(subject).toBeTruthy()
      expect(html).toContain('<!DOCTYPE html>')
    }
    await expect(c.admin.emailPreview.preview({ type: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})
