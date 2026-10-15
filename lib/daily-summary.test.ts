import { describe, expect, it } from 'vitest'
import { summarySections, summarySubject, type SummaryLine } from './daily-summary'

const line = (over: Partial<SummaryLine>): SummaryLine => ({
  role: 'owner',
  kind: 'activity',
  group: 'Westminster',
  text: 't',
  href: '/',
  ...over,
})

describe('daily summary', () => {
  it('puts decisions first, then my tasks, then each project by urgency', () => {
    const lines = [
      line({ kind: 'activity', text: 'Jo wants to help' }),
      line({ role: 'assignee', kind: 'check_in', group: 'Quick Tasks', text: 'check in' }),
      line({ kind: 'at_risk', text: 'at risk' }),
      line({ group: 'Library', kind: 'activity', text: 'post' }),
      line({ kind: 'needs_decision', text: 'decide' }),
      line({ role: 'assignee', kind: 'overdue', text: 'late' }),
    ]
    const sections = summarySections(lines)
    expect(sections.map((s) => [s.heading, s.lines.map((l) => l.text)])).toEqual([
      ['Needs your decision', ['decide']],
      ['Your tasks', ['late', 'check in']],
      ['Westminster', ['at risk', 'Jo wants to help']],
      ['Library', ['post']],
    ])
    expect(sections.map((s) => s.project)).toEqual([undefined, undefined, true, true])
    expect(summarySections([])).toEqual([])
  })

  it('counts what needs the person in the subject', () => {
    expect(summarySubject([line({ kind: 'overdue' }), line({ kind: 'activity' })])).toBe(
      'Catalyse: 1 thing needs you today',
    )
    expect(summarySubject([line({ kind: 'overdue' }), line({ kind: 'due_today' })])).toBe(
      'Catalyse: 2 things need you today',
    )
    expect(summarySubject([line({ kind: 'activity' })])).toBe('Catalyse: your daily summary')
  })
})
