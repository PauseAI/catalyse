import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createProject, createTask, createVolunteer } from '@/test/factories'
import {
  describeEvent,
  editKind,
  eventPersonIds,
  recordChange,
  recordEvent,
  updateWorkItem,
  workItemChanges,
  type EventToDescribe,
} from './work-item-events'

const OCT_14 = '2026-10-14T12:00:00.000Z'
const names = new Map([
  [1, 'Sam'],
  [2, 'Ali'],
])
const nameOf = (id: number) => names.get(id) ?? 'someone'

/** Words an event by Sam (id 1) on a task, unless the test says otherwise. */
function say(
  kind: string,
  before: object,
  after: object,
  over: Partial<EventToDescribe> & { itemType?: string } = {},
) {
  const { itemType = 'TASK', ...rest } = over
  return describeEvent(
    { kind, actorId: 1, actorName: 'Sam', before, after, ...rest },
    itemType,
    nameOf,
  )
}

describe('workItemChanges', () => {
  it('keeps only tracked fields that change, with dates as ISO strings', () => {
    const row = {
      id: 1,
      title: 'Old',
      description: 'Same',
      deadline: null,
      updatedAt: new Date(OCT_14),
      startDate: new Date(OCT_14),
    }
    expect(
      workItemChanges(row, {
        title: 'New',
        description: 'Same',
        deadline: new Date(OCT_14),
        updatedAt: new Date(),
        startDate: new Date(OCT_14),
        status: undefined,
      }),
    ).toEqual({
      before: { title: 'Old', deadline: null },
      after: { title: 'New', deadline: OCT_14 },
    })
  })
})

describe('editKind', () => {
  it('names claims, assignments and releases from the assignee change', () => {
    expect(editKind({ before: { assigneeId: null }, after: { assigneeId: 1 } }, 1)).toBe('claimed')
    expect(editKind({ before: { assigneeId: null }, after: { assigneeId: 2 } }, 1)).toBe('assigned')
    expect(editKind({ before: { assigneeId: 2 }, after: { assigneeId: 1 } }, 1)).toBe('assigned')
    expect(editKind({ before: { assigneeId: 2 }, after: { assigneeId: null } }, 1)).toBe('released')
  })

  it('calls a lone status change a status change, and anything else an edit', () => {
    const status = {
      before: { status: 'a', startedAt: null },
      after: { status: 'b', startedAt: OCT_14 },
    }
    expect(editKind(status, 1)).toBe('status')
    expect(editKind({ before: { title: 'a' }, after: { title: 'b' } }, 1)).toBe('edited')
  })
})

describe('recording', () => {
  it('writes one event per change, none for a write that changes nothing', async () => {
    const actor = await createVolunteer()
    const project = await createProject()
    const task = await createTask(project.id, { title: 'Banners' })

    await updateWorkItem(task, { title: 'Banners', updatedAt: new Date() }, { actorId: actor.id })
    await updateWorkItem(task, { title: 'Flags' }, { actorId: actor.id })
    await prisma.$transaction((tx) =>
      recordEvent(tx, {
        workItemId: task.id,
        actorId: null,
        kind: 'baseline',
        before: {},
        after: {},
      }),
    )
    const events = await prisma.workItemEvent.findMany({
      where: { workItemId: task.id },
      orderBy: { id: 'asc' },
    })
    expect(events).toMatchObject([
      {
        actorId: actor.id,
        kind: 'edited',
        before: { title: 'Banners' },
        after: { title: 'Flags' },
      },
      { actorId: null, kind: 'baseline' },
    ])
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: task.id } })).title).toBe(
      'Flags',
    )
  })

  it('leaves no event behind when the write fails', async () => {
    const project = await createProject()
    const task = await createTask(project.id)
    await expect(
      prisma.$transaction(async (tx) => {
        await recordChange(tx, { row: task, data: { title: 'Gone' }, actorId: null })
        throw new Error('the write failed')
      }),
    ).rejects.toThrow('the write failed')
    expect(await prisma.workItemEvent.count({ where: { workItemId: task.id } })).toBe(0)
  })
})

describe('eventPersonIds', () => {
  it('collects the assignees and requesters events name', () => {
    expect(
      eventPersonIds([
        { before: { assigneeId: null }, after: { assigneeId: 1 } },
        { before: { requestedById: 2 }, after: { requestedById: null, title: 'x' } },
        { before: {}, after: { assigneeId: 1 } },
      ]).sort(),
    ).toEqual([1, 2])
  })
})

describe('describeEvent', () => {
  it('words each action', () => {
    expect(say('started', {}, { status: 'in_progress' })).toBe('Sam started this')
    expect(say('claimed', {}, { assigneeId: 1 })).toBe('Sam claimed this')
    expect(say('claimed', {}, { assigneeId: 1 }, { itemType: 'PROJECT' })).toBe(
      'Sam became the owner',
    )
    expect(say('requested', {}, { requestedById: 1 })).toBe('Sam asked to take this')
    expect(say('submitted', {}, { status: 'under_review' })).toBe('Sam submitted this for review')
    expect(say('submitted', {}, { status: 'completed' })).toBe('Sam submitted this and it is Done')
    expect(say('accepted', {}, { status: 'completed' })).toBe('Sam accepted this as Done')
    expect(say('changes_requested', {}, { status: 'in_progress' })).toBe('Sam asked for changes')
    expect(say('reopened', {}, { status: 'in_progress', asDeputy: true })).toBe(
      'Sam (deputy) reopened this',
    )
    expect(say('replanned', {}, { finish: OCT_14, reason: 'venue moved' })).toBe(
      'Sam replanned this to finish 14 Oct 2026: venue moved',
    )
    expect(say('baseline', {}, {})).toBe('Sam saved the current dates as the plan')
    expect(say('reopened', {}, {}, { actorName: null })).toBe('Someone reopened this')
  })

  it('says who a release took the task from, or whose request it ended', () => {
    expect(say('released', { assigneeId: 1 }, { assigneeId: null })).toBe('Sam released this')
    expect(say('released', { assigneeId: 2 }, { assigneeId: null })).toBe('Sam unassigned Ali')
    expect(say('released', { assigneeId: 2 }, { assigneeId: null }, { actorId: null })).toBe(
      'Ali was taken off this after no updates',
    )
    expect(say('released', { requestedById: 1 }, { requestedById: null })).toBe(
      'Sam withdrew their request to take this',
    )
    expect(say('released', { requestedById: 2 }, { requestedById: null })).toBe(
      "Sam turned down Ali's request to take this",
    )
    expect(say('released', { status: 'in_progress' }, { status: 'open' })).toBe('Sam released this')
  })

  it('words helpers joining, leaving and being taken off', () => {
    expect(say('helper_joined', {}, { helperId: 1 })).toBe('Sam joined as a helper')
    expect(say('helper_left', { helperId: 1 }, {})).toBe('Sam stopped helping')
    expect(say('helper_removed', {}, { helperId: 2 })).toBe('Sam took Ali off the helpers')
    expect(say('edited', { helpersWanted: null }, { helpersWanted: 3 })).toBe(
      'Sam changed the helpers wanted',
    )
    expect(eventPersonIds([{ before: {}, after: { helperId: 2 } }])).toEqual([2])
  })

  it('words dependency changes with the task waited on', () => {
    const link = (lagDays: number) => ({ predecessorId: 9, predecessorTitle: 'Venue', lagDays })
    expect(say('dependency_added', {}, link(0))).toBe("Sam made this wait on 'Venue'")
    expect(say('dependency_added', {}, link(2))).toBe(
      "Sam made this wait on 'Venue', and set a gap of 2 days after 'Venue'",
    )
    expect(say('dependency_removed', link(0), {})).toBe("Sam stopped this waiting on 'Venue'")
    expect(say('dependency_lag', link(0), link(1))).toBe("Sam set a gap of 1 day after 'Venue'")
    expect(say('dependency_lag', link(1), link(-3))).toBe("Sam let this overlap 'Venue' by 3 days")
    expect(say('dependency_lag', link(1), link(0))).toBe("Sam removed the gap after 'Venue'")
  })

  it('words an edit from the fields it changed', () => {
    expect(say('status', { status: 'not_started' }, { status: 'completed' })).toBe(
      'Sam moved this to Done',
    )
    expect(
      say('status', { status: 'open' }, { status: 'mystery' }, { itemType: 'QUICK_TASK' }),
    ).toBe('Sam moved this to mystery')
    expect(
      say('status', { status: 'open' }, { status: 'completed' }, { itemType: 'QUICK_TASK' }),
    ).toBe('Sam moved this to Done')
    expect(
      say('status', { status: 'ready' }, { status: 'in_progress' }, { itemType: 'PROJECT' }),
    ).toBe('Sam moved this to In progress')
    expect(
      say(
        'edited',
        { title: 'Old', isAnchor: false, startDate: null, deadline: OCT_14 },
        {
          title: 'New',
          isAnchor: true,
          startDate: OCT_14,
          deadline: null,
          description: 'x',
          estimatedHours: 3,
          country: 'UK',
          localGroup: 'Leeds',
          completedAt: OCT_14,
        },
      ),
    ).toBe(
      "Sam renamed this 'New', made this a key date, set the start to 14 Oct 2026, cleared the deadline and changed the description, effort and location",
    )
    expect(say('edited', { isAnchor: true }, { isAnchor: false })).toBe(
      'Sam took the key date off this',
    )
    expect(say('edited', { reviewNotes: 'a' }, { reviewNotes: 'b' })).toBe('Sam changed this')
  })

  it('names the new assignee, or the owner of a project', () => {
    expect(say('assigned', { assigneeId: null }, { assigneeId: 2 })).toBe(
      'Sam assigned this to Ali',
    )
    expect(say('assigned', { assigneeId: 1 }, { assigneeId: null })).toBe('Sam unassigned Sam')
    expect(
      say(
        'assigned',
        { assigneeId: null, status: 'ready' },
        { assigneeId: 2, status: 'in_progress' },
        { itemType: 'PROJECT' },
      ),
    ).toBe('Sam made Ali the owner and moved this to In progress')
    expect(say('edited', { assigneeId: 2 }, { assigneeId: null }, { itemType: 'PROJECT' })).toBe(
      'Sam removed Ali as owner',
    )
    expect(say('assigned', { assigneeId: null }, { assigneeId: 7 })).toBe(
      'Sam assigned this to someone',
    )
  })
})
