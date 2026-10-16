import { describe, expect, it } from 'vitest'
import {
  NO_ACCESS,
  actingOn,
  canAdminChapter,
  canAppointDeputies,
  inChapter,
  isStaff,
  type ChapterAccess,
} from './chapter-access'

const global: ChapterAccess = { globalAdmin: true, chapterId: null, role: null }
const lead: ChapterAccess = { globalAdmin: false, chapterId: 1, role: 'LEAD' }
const deputy: ChapterAccess = { globalAdmin: false, chapterId: 1, role: 'DEPUTY' }
const member: ChapterAccess = { globalAdmin: false, chapterId: 1, role: null }
const pooled: ChapterAccess = NO_ACCESS

describe('chapter access', () => {
  it('lets a global admin run every chapter and the pool', () => {
    for (const chapterId of [1, 2, null]) {
      expect(canAdminChapter(global, chapterId)).toBe(true)
      expect(canAppointDeputies(global, chapterId)).toBe(true)
      expect(inChapter(global, chapterId)).toBe(true)
    }
    expect(isStaff(global)).toBe(false)
  })

  it('lets staff run their own chapter only, and only the lead appoint deputies', () => {
    expect(isStaff(lead) && isStaff(deputy)).toBe(true)
    expect(canAdminChapter(lead, 1) && canAdminChapter(deputy, 1)).toBe(true)
    expect(canAdminChapter(deputy, 2) || canAdminChapter(deputy, null)).toBe(false)
    expect(canAppointDeputies(lead, 1)).toBe(true)
    expect(canAppointDeputies(lead, 2) || canAppointDeputies(deputy, 1)).toBe(false)
  })

  it('gives members no admin powers and shows them their own chapter or the pool', () => {
    expect(isStaff(member) || canAdminChapter(member, 1)).toBe(false)
    expect(inChapter(member, 1)).toBe(true)
    expect(inChapter(member, 2) || inChapter(member, null)).toBe(false)
    expect(inChapter(pooled, null)).toBe(true)
    expect(inChapter(pooled, 1)).toBe(false)
  })

  it('makes a volunteer an admin for the chapter they act on and nowhere else', () => {
    const volunteer = { id: 7, isAdmin: false }
    expect(actingOn(volunteer, deputy, 1)).toEqual({ id: 7, isAdmin: true })
    expect(actingOn(volunteer, deputy, 2)).toEqual({ id: 7, isAdmin: false })
    expect(actingOn({ id: 7, isAdmin: true }, member, 1).isAdmin).toBe(false)
  })
})
