import { describe, it, expect } from 'vitest'
import { NON_UPDATE_TYPES, categoryOf, typesIn } from './notification-categories'

describe('notification categories', () => {
  it('sorts types into needs action, messages and updates, defaulting to update', () => {
    expect(categoryOf('new_interest')).toBe('needs_action')
    expect(categoryOf('mention')).toBe('needs_action')
    expect(categoryOf('message_received')).toBe('message')
    expect(categoryOf('project_approved')).toBe('update')
    expect(categoryOf('never_heard_of_it')).toBe('update')
    expect(typesIn('message')).toEqual(['message_received'])
    expect(typesIn('needs_action')).toContain('team_join_request')
    expect(NON_UPDATE_TYPES).toEqual([...typesIn('needs_action'), ...typesIn('message')])
  })
})
