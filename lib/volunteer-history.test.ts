import { describe, it, expect } from 'vitest'
import { projectHistory, type HistoryRow } from './volunteer-history'

const ME = 7
const day = (n: number) => new Date(Date.UTC(2026, 0, n))

const row = (overrides: Partial<HistoryRow>): HistoryRow => ({
  id: 1,
  title: 'Project',
  status: 'in_progress',
  creatorId: null,
  assigneeId: null,
  createdAt: day(1),
  completedAt: null,
  deputies: [],
  interests: [],
  children: [],
  ...overrides,
})

const interest = (interestType: string, status: string, respondedAt: Date | null = day(5)) => ({
  interestType,
  status,
  createdAt: day(2),
  respondedAt,
})

describe('projectHistory', () => {
  it('names each role with when it began, the largest first', () => {
    const [created] = projectHistory([row({ creatorId: ME, assigneeId: ME })], ME)
    expect(created.roles).toEqual([
      { role: 'owner', since: day(1), ended: false },
      { role: 'creator', since: day(1), ended: false },
    ])

    const [offered] = projectHistory(
      [row({ assigneeId: ME, interests: [interest('want_to_own', 'accepted', day(9))] })],
      ME,
    )
    expect(offered.roles).toEqual([{ role: 'owner', since: day(9), ended: false }])

    // Made owner directly, with nothing recording when.
    const [assigned] = projectHistory([row({ assigneeId: ME })], ME)
    expect(assigned.roles).toEqual([{ role: 'owner', since: null, ended: false }])

    const [deputy] = projectHistory(
      [
        row({
          deputies: [{ createdAt: day(4) }],
          interests: [interest('want_to_contribute', 'accepted')],
        }),
      ],
      ME,
    )
    expect(deputy.roles).toEqual([{ role: 'deputy', since: day(4), ended: false }])
  })

  it('keeps a member who left or was taken off as past', () => {
    const [member, left, removed] = projectHistory(
      [
        row({ id: 1, interests: [interest('want_to_contribute', 'accepted')] }),
        row({ id: 2, interests: [interest('want_to_contribute', 'withdrawn')] }),
        row({ id: 3, interests: [interest('want_to_contribute', 'removed', null)] }),
      ],
      ME,
    )
    expect(member).toMatchObject({
      current: true,
      roles: [{ role: 'member', since: day(5), ended: false }],
    })
    expect(left).toMatchObject({
      current: false,
      roles: [{ role: 'member', since: day(5), ended: true }],
    })
    expect(removed.roles).toEqual([{ role: 'member', since: day(2), ended: true }])
  })

  it('lists the tasks they led or helped on, done or left as past', () => {
    const task = {
      title: 'Task',
      status: 'in_progress',
      assigneeId: null,
      claimedAt: null,
      completedAt: null,
      interests: [],
    }
    const [entry] = projectHistory(
      [
        row({
          children: [
            { ...task, id: 10, assigneeId: ME, claimedAt: day(3) },
            {
              ...task,
              id: 11,
              status: 'completed',
              completedAt: day(8),
              interests: [interest('want_to_help_task', 'accepted')],
            },
            { ...task, id: 12, interests: [interest('want_to_help_task', 'removed')] },
          ],
        }),
      ],
      ME,
    )
    expect(entry.roles).toEqual([])
    expect(entry.current).toBe(true)
    expect(entry.tasks).toEqual([
      expect.objectContaining({ id: 10, role: 'assignee', since: day(3), current: true }),
      expect.objectContaining({ id: 11, role: 'helper', ended: false, current: false }),
      expect.objectContaining({ id: 12, role: 'helper', ended: true, current: false }),
    ])

    const [helperOnly] = projectHistory(
      [
        row({
          children: [{ ...task, id: 12, interests: [interest('want_to_help_task', 'removed')] }],
        }),
      ],
      ME,
    )
    expect(helperOnly.current).toBe(false)
  })

  it('puts current work first, then the most recently active', () => {
    const ids = projectHistory(
      [
        row({ id: 1, creatorId: ME, status: 'completed', completedAt: day(10) }),
        row({ id: 2, creatorId: ME, createdAt: day(2) }),
        row({ id: 3, creatorId: ME, status: 'completed', completedAt: day(20) }),
        row({ id: 4, creatorId: ME, status: 'completed', createdAt: null }),
        row({
          id: 5,
          status: 'completed',
          children: [
            {
              id: 50,
              title: 'Late task',
              status: 'completed',
              assigneeId: ME,
              claimedAt: null,
              completedAt: day(30),
              interests: [],
            },
          ],
        }),
      ],
      ME,
    ).map((e) => e.id)
    expect(ids).toEqual([2, 5, 3, 1, 4])
  })
})
