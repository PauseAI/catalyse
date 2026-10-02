import { describe, expect, it } from 'vitest'
import {
  serializeProjectAsTemplate,
  buildInstantiatePlan,
  type SourceProject,
  type SourceTaskWithSkills,
} from './template-porting'

const project: SourceProject = {
  title: 'Launch campaign',
  description: 'A repeatable launch',
  projectType: 'sprint',
  estimatedDuration: '2 weeks',
  timeCommitmentHoursPerWeek: 5,
  urgency: 'high',
  collaborationLink: null,
  remoteEligibility: 'GLOBAL',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  durationDays: 14,
}

const tasks: SourceTaskWithSkills[] = [
  {
    id: 1,
    title: 'Book venue',
    description: null,
    status: 'open',
    assigneeId: null,
    assigneeEmail: null,
    deadline: null,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    durationDays: 2,
    baselineSetAt: null,
    featuredAsQuickTask: false,
    isAnchor: false,
    timing: 'flexible',
    sortOrder: 0,
    skills: [{ skillId: 1, isRequired: true }],
  },
  {
    id: 2,
    title: 'Print posters',
    description: null,
    status: 'open',
    assigneeId: null,
    assigneeEmail: null,
    deadline: null,
    startDate: new Date('2026-01-03T00:00:00.000Z'),
    durationDays: 3,
    baselineSetAt: null,
    featuredAsQuickTask: false,
    isAnchor: false,
    timing: 'flexible',
    sortOrder: 1,
    skills: [],
  },
]

describe('serializeProjectAsTemplate', () => {
  it('computes offsets relative to the project start date', () => {
    const structure = serializeProjectAsTemplate(
      project,
      tasks,
      [{ predecessorId: 1, successorId: 2, lagDays: 0 }],
      [{ skillId: 2, isRequired: false }],
    )
    expect(structure.startOffsetDays).toBe(0)
    expect(structure.tasks[0].startOffsetDays).toBe(0)
    expect(structure.tasks[1].startOffsetDays).toBe(2)
    expect(structure.tasks[1].dependsOn).toEqual([{ on: 'task-1', lagDays: 0 }])
    expect(structure.skills).toEqual([{ skillId: 2, isRequired: false }])
    expect(structure.tasks[0].skills).toEqual([{ skillId: 1, isRequired: true }])
  })

  it('leaves offsets null when nothing is scheduled', () => {
    const unscheduled: SourceProject = { ...project, startDate: null }
    const unscheduledTasks: SourceTaskWithSkills[] = tasks.map((t) => ({
      ...t,
      startDate: null,
    }))
    const structure = serializeProjectAsTemplate(unscheduled, unscheduledTasks, [], [])
    expect(structure.startOffsetDays).toBeNull()
    expect(structure.tasks.every((t) => t.startOffsetDays === null)).toBe(true)
  })
})

describe('buildInstantiatePlan', () => {
  it('re-anchors offsets to the new start date', () => {
    const structure = serializeProjectAsTemplate(
      project,
      tasks,
      [{ predecessorId: 1, successorId: 2, lagDays: 1 }],
      [],
    )
    const plan = buildInstantiatePlan(structure, {
      newTitle: 'Launch campaign — Kenya',
      newStartDate: '2027-03-10',
    })
    expect(plan.errors).toEqual([])
    expect(plan.project.title).toBe('Launch campaign — Kenya')
    expect(plan.project.startDate?.toISOString().slice(0, 10)).toBe('2027-03-10')
    expect(plan.taskCreates[0].startDate?.toISOString().slice(0, 10)).toBe('2027-03-10')
    expect(plan.taskCreates[1].startDate?.toISOString().slice(0, 10)).toBe('2027-03-12')
    expect(plan.dependencyCreates).toEqual([
      {
        predecessor: { kind: 'created', ref: 'task-1' },
        successor: { kind: 'created', ref: 'task-2' },
        lagDays: 1,
      },
    ])
  })

  it('flags a self-dependency, an unknown ref and a duplicate ref', () => {
    const structure = serializeProjectAsTemplate(project, tasks, [], [])
    structure.tasks[0].dependsOn = [{ on: 'task-1', lagDays: 0 }]
    structure.tasks[1].dependsOn = [{ on: 'ghost', lagDays: 0 }]
    structure.tasks.push({ ...structure.tasks[0], dependsOn: [] })
    const plan = buildInstantiatePlan(structure, { newTitle: 'X', newStartDate: null })
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('cannot depend on itself'),
        expect.stringContaining('unknown ref "ghost"'),
        expect.stringContaining('Duplicate task ref "task-1"'),
      ]),
    )
  })

  it('leaves dates null when no new start date is given', () => {
    const structure = serializeProjectAsTemplate(project, tasks, [], [])
    const plan = buildInstantiatePlan(structure, { newTitle: 'X', newStartDate: null })
    expect(plan.project.startDate).toBeNull()
    expect(plan.taskCreates.every((t) => t.startDate === null)).toBe(true)
  })
})
