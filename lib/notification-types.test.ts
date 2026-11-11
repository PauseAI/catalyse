import { describe, it, expect } from 'vitest'
import { typesIn } from './notification-categories'
import { ADMIN_NOTIFICATION_TYPES } from './admin-notifications'
import {
  NOTIFICATION_TYPES,
  PRESETS,
  applyPreset,
  matchingPreset,
  defaultDelivery,
  isKnownType,
  preferenceRows,
  resolveDelivery,
  type Delivery,
} from './notification-types'

const volunteer = { isTechnicalAdmin: false, isStaff: false }
const staff = { isTechnicalAdmin: false, isStaff: true }
const technical = { isTechnicalAdmin: true, isStaff: false }

describe('notification types', () => {
  it('lists every needs-action and message type, and every admin type as for staff', () => {
    for (const t of [...typesIn('needs_action'), ...typesIn('message')]) {
      expect(isKnownType(t), t).toBe(true)
    }
    const staffTypes = preferenceRows(staff, new Map()).map((r) => r.type)
    const volunteerTypes = preferenceRows(volunteer, new Map()).map((r) => r.type)
    for (const t of ADMIN_NOTIFICATION_TYPES) {
      expect(staffTypes, t).toContain(t)
      expect(volunteerTypes, t).not.toContain(t)
    }
    expect(NOTIFICATION_TYPES).toContain('call_posted')
  })

  it('resolves a choice, a default, a fixed type and an unknown one', () => {
    const who = { isTechnicalAdmin: false }
    expect(resolveDelivery('project_approved', who, undefined, true)).toBe('email')
    expect(resolveDelivery('project_approved', who, 'digest', true)).toBe('digest')
    expect(resolveDelivery('mention', who, undefined, false)).toBe('in_app')
    expect(resolveDelivery('mention', who, 'email', false)).toBe('email')
    expect(resolveDelivery('call_posted', who, 'email', true)).toBe('in_app')
    expect(resolveDelivery('message_received', who, 'in_app', true)).toBe('in_app')
    expect(resolveDelivery('brand_new', who, undefined, true)).toBe('email')
    expect(resolveDelivery('brand_new', who, undefined, false)).toBe('in_app')
    expect(resolveDelivery('brand_new', who, 'digest', false)).toBe('digest')
    expect(defaultDelivery('brand_new', who)).toBeNull()
    expect(defaultDelivery('new_bug_report', { isTechnicalAdmin: true })).toBe('email')
    expect(defaultDelivery('new_bug_report', who)).toBe('in_app')
  })

  it('builds the panel rows: choices over defaults, fixed rows with their reason', () => {
    const rows = preferenceRows(volunteer, new Map([['project_approved', 'digest' as const]]))
    expect(rows.find((r) => r.type === 'project_approved')).toEqual({
      type: 'project_approved',
      label: 'Your project proposal is approved',
      category: 'update',
      delivery: 'digest',
      fixed: null,
      staffOnly: false,
    })
    expect(rows.find((r) => r.type === 'call_posted')).toMatchObject({
      delivery: 'in_app',
      fixed: { shows: 'In app only', why: expect.stringContaining('send cap') },
    })
    expect(rows.find((r) => r.type === 'message_received')?.category).toBe('message')
    expect(rows.some((r) => r.type === 'csp_violation_summary')).toBe(false)
    const tech = preferenceRows(technical, new Map()).map((r) => r.type)
    expect(tech).toContain('csp_violation_summary')
    expect(tech).toContain('new_bug_report')
  })

  describe('presets', () => {
    const rows = preferenceRows(staff, new Map())
    const choosable = rows.filter((r) => !r.fixed)
    const of = (choices: Record<string, string>, type: string) => choices[type]

    it('Recommended emails what needs you, messages and admin work, and digests updates', () => {
      const c = applyPreset('recommended', rows)
      expect(of(c, 'new_interest')).toBe('email')
      expect(of(c, 'message_received')).toBe('email')
      expect(of(c, 'project_approved')).toBe('digest')
      expect(of(c, 'new_volunteer_signup')).toBe('email')
      expect(of(c, 'chapter_joined')).toBe('email')
    })

    it('the others set every choice alike', () => {
      for (const [key, delivery] of [
        ['email', 'email'],
        ['digest', 'digest'],
        ['in_app', 'in_app'],
      ] as const) {
        const c = applyPreset(key, rows)
        expect(new Set(Object.values(c))).toEqual(new Set([delivery]))
        expect(Object.keys(c).sort()).toEqual(choosable.map((r) => r.type).sort())
      }
    })

    it('leaves fixed types out, and names the preset the choices match, or none', () => {
      for (const p of PRESETS) {
        const c = applyPreset(p.key, rows)
        expect(c.call_posted).toBeUndefined()
        expect(c.finish_by_today).toBeUndefined()
        expect(matchingPreset(rows, (r) => c[r.type] ?? r.delivery)).toBe(p.key)
      }
      // Today's defaults are a mix of their own.
      expect(matchingPreset(rows, (r) => r.delivery)).toBeNull()
      const c: Record<string, Delivery> = { ...applyPreset('digest', rows), mention: 'email' }
      expect(matchingPreset(rows, (r) => c[r.type] ?? r.delivery)).toBeNull()
    })
  })
})
