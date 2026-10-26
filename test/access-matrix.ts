import { expect } from 'vitest'
import type { Volunteer } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { withoutAdminRights } from '@/lib/view-as'
import {
  chapterFor,
  createAdmin,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createMember,
  createProject,
  createTask,
} from './factories'
import { clientAs } from './rpc'

/**
 * Who may do what on a project and its tasks, asked of every kind of person at once. Each
 * question runs against a fresh project, so one person's answer never changes the next one's.
 */

export const PERSONAS = [
  'globalAdmin',
  'adminViewingAsVolunteer',
  'chapterLead',
  'chapterDeputy',
  'otherChapterLead',
  'owner',
  'proposer',
  'projectDeputy',
  'member',
  'taskAssignee',
  'stranger',
] as const
export type Persona = (typeof PERSONAS)[number]

export type People = Record<Persona, Volunteer> & {
  /** Targets: never the one acting. */
  newOwner: Volunteer
  newcomer: Volunteer
  applicant: Volunteer
  invitee: Volunteer
}

/** The accounts, made once per file. The project's chapter is the UK. */
export async function makePeople(): Promise<People> {
  const uk = await chapterFor('UK')
  const other = await createChapter()
  const admin = await createAdmin()
  return {
    globalAdmin: admin,
    adminViewingAsVolunteer: await createAdmin(),
    chapterLead: await createChapterLead(uk),
    chapterDeputy: await createChapterDeputy(uk),
    otherChapterLead: await createChapterLead(other),
    owner: await createMember(uk),
    proposer: await createMember(uk),
    projectDeputy: await createMember(uk),
    member: await createMember(uk),
    taskAssignee: await createMember(uk),
    stranger: await createMember(uk),
    newOwner: await createMember(uk),
    newcomer: await createMember(uk),
    applicant: await createMember(uk),
    invitee: await createMember(uk),
  }
}

/** The client a persona acts through; the volunteer view drops admin rights as a request does. */
export function clientFor(people: People, persona: Persona) {
  return persona === 'adminViewingAsVolunteer'
    ? clientAs(withoutAdminRights(people[persona]), { viewingAsVolunteer: true })
    : clientAs(people[persona])
}

const accepted = (volunteerId: number, workItemId: number, interestType = 'want_to_contribute') =>
  prisma.workItemInterest.create({
    data: { volunteerId, workItemId, interestType, status: 'accepted', respondedAt: new Date() },
  })

/**
 * A running UK project: owned by `owner`, proposed by `proposer`, with `projectDeputy`,
 * `member` and `taskAssignee` on it, `applicant` waiting to be answered, `invitee` invited and
 * a change request from an admin on record. Its tasks, one in each state a question needs:
 * - `open`: nobody's, created by the owner
 * - `mine`: nobody's, created by `member`
 * - `held`: `taskAssignee`'s, not started
 * - `submitted`: `taskAssignee`'s, waiting for review
 * - `done`: `taskAssignee`'s, accepted
 * - `helping`: led by `taskAssignee`, with `member` helping and room for more
 *
 * A draft (`status: 'draft'`) has its proposer and nobody else: no owner, members or requests.
 */
export async function makeWorld(
  people: People,
  { status = 'in_progress', showTimeline = true } = {},
) {
  const uk = await chapterFor('UK')
  const draft = status === 'draft'
  const project = await createProject({
    status,
    showTimeline,
    nationalChapterId: uk.id,
    creatorId: people.proposer.id,
    assigneeId: draft ? null : people.owner.id,
  })
  const task = (overrides: Parameters<typeof createTask>[1] = {}) =>
    createTask(project.id, { creatorId: people.owner.id, ...overrides })
  const tasks = {
    open: await task(),
    mine: await task({ creatorId: people.member.id }),
    held: await task({ assigneeId: people.taskAssignee.id }),
    submitted: await task({ assigneeId: people.taskAssignee.id, status: 'under_review' }),
    done: await task({ assigneeId: people.taskAssignee.id, status: 'completed' }),
    helping: await task({
      assigneeId: people.taskAssignee.id,
      status: 'in_progress',
      helpersWanted: 3,
    }),
  }
  if (draft) return { project, tasks, helperInterestId: 0 }

  for (const p of [people.projectDeputy, people.member, people.taskAssignee]) {
    await accepted(p.id, project.id)
  }
  await prisma.projectDeputy.create({
    data: { projectId: project.id, volunteerId: people.projectDeputy.id },
  })
  await prisma.workItemInterest.create({
    data: {
      volunteerId: people.applicant.id,
      workItemId: project.id,
      interestType: 'want_to_contribute',
      status: 'pending',
    },
  })
  await prisma.workItemInterest.create({
    data: {
      volunteerId: people.invitee.id,
      workItemId: project.id,
      interestType: 'want_to_contribute',
      status: 'invited',
      origin: 'invited',
      invitedById: people.owner.id,
    },
  })
  await prisma.projectReviewRequest.create({
    data: { projectId: project.id, message: 'Say more', requestedById: people.globalAdmin.id },
  })
  const helper = await accepted(people.member.id, tasks.helping.id, 'want_to_help_task')
  return { project, tasks, helperInterestId: helper.id }
}

export type World = Awaited<ReturnType<typeof makeWorld>>
export type Client = ReturnType<typeof clientFor>

/** What came of an attempt: `ok`, or the error's code. */
export async function outcome(attempt: () => Promise<unknown>): Promise<string> {
  try {
    const result = await attempt()
    return typeof result === 'string' ? result : 'ok'
  } catch (e) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string') return code
    throw e
  }
}

/**
 * Asks every persona the same question, each against its own fresh world, and checks the
 * answers: `ok` for those listed in `allowed`, `denied` (FORBIDDEN unless given) for the rest,
 * with `others` naming any persona whose answer is something else again.
 */
export async function expectAccess(
  people: People,
  question: {
    world?: Parameters<typeof makeWorld>[1]
    allowed: readonly Persona[]
    denied?: string
    others?: Partial<Record<Persona, string>>
    attempt: (as: Client, world: World, people: People) => Promise<unknown>
  },
) {
  const answers: Partial<Record<Persona, string>> = {}
  const expected: Partial<Record<Persona, string>> = {}
  for (const persona of PERSONAS) {
    const world = await makeWorld(people, question.world)
    answers[persona] = await outcome(() =>
      question.attempt(clientFor(people, persona), world, people),
    )
    expected[persona] =
      question.others?.[persona] ??
      (question.allowed.includes(persona) ? 'ok' : (question.denied ?? 'FORBIDDEN'))
  }
  expect(answers).toEqual(expected)
}

/** Everyone who runs the UK chapter's projects as an admin. */
export const ADMINS = ['globalAdmin', 'chapterLead', 'chapterDeputy'] as const
