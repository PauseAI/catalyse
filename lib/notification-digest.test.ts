import { describe, it, expect } from 'vitest'
import { digestSections, digestSubject } from './notification-digest'

describe('notification digest', () => {
  it('groups items under their Inbox categories in Inbox order, leaving out empty ones', () => {
    const sections = digestSections([
      { type: 'project_approved', title: 'A', body: null, link: '/a' },
      { type: 'new_interest', title: 'B', body: 'b', link: null },
      { type: 'task_done', title: 'C', body: null, link: '/c' },
    ])
    expect(sections).toEqual([
      {
        category: 'needs_action',
        heading: 'Needs action',
        items: [{ title: 'B', body: 'b', href: '/inbox' }],
      },
      {
        category: 'update',
        heading: 'Updates',
        items: [
          { title: 'A', body: null, href: '/a' },
          { title: 'C', body: null, href: '/c' },
        ],
      },
    ])
    expect(digestSubject(1)).toBe('Catalyse: 1 notification from the last day')
    expect(digestSubject(2)).toBe('Catalyse: 2 notifications from the last day')
  })
})
