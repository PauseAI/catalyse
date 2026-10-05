import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { ApprovalStatus, WorkItemType, ProjectStatus } from '@/generated/prisma/enums'
import type { Prisma } from '@/generated/prisma/client'

let seq = 0
export const nextSeq = () => ++seq

export const TEST_PASSWORD = 'correct-horse-battery'
// PBKDF2 is deliberately slow, and every volunteer shares the password, so hash it once per file.
let testPasswordHash: string | undefined
const hashedTestPassword = () => (testPasswordHash ??= hashPassword(TEST_PASSWORD))

/** An approved, email-confirmed volunteer. Pass overrides to make an admin, a pending one, etc. */
export async function createVolunteer(
  overrides: Partial<Prisma.VolunteerUncheckedCreateInput> = {},
) {
  const n = nextSeq()
  return prisma.volunteer.create({
    data: {
      name: `Volunteer ${n}`,
      email: `volunteer${n}@example.com`,
      bio: 'A test volunteer with a bio long enough to pass validation.',
      passwordHash: hashedTestPassword(),
      approvalStatus: ApprovalStatus.approved,
      emailConfirmed: true,
      consentMakeProfileVisibleInDirectory: true,
      consentContactableByProjectOwners: true,
      ...overrides,
    },
  })
}

export const createAdmin = (overrides: Partial<Prisma.VolunteerUncheckedCreateInput> = {}) =>
  createVolunteer({ isAdmin: true, ...overrides })

let superSeq = 0
/** An admin whose email is in ADMIN_EMAILS (see test/setup-db.ts) — a super-admin. */
export const createSuperAdmin = (overrides: Partial<Prisma.VolunteerUncheckedCreateInput> = {}) =>
  createAdmin({ email: `admin${superSeq++ || ''}@example.com`, ...overrides })

export async function createProject(overrides: Partial<Prisma.WorkItemUncheckedCreateInput> = {}) {
  const n = nextSeq()
  return prisma.workItem.create({
    data: {
      type: WorkItemType.PROJECT,
      status: ProjectStatus.ready,
      title: `Project ${n}`,
      description: 'A test project',
      ...overrides,
    },
  })
}

export async function createTask(
  parentId: number,
  overrides: Partial<Prisma.WorkItemUncheckedCreateInput> = {},
) {
  const n = nextSeq()
  return prisma.workItem.create({
    data: {
      type: WorkItemType.TASK,
      status: 'open',
      title: `Task ${n}`,
      parentId,
      ...overrides,
    },
  })
}

export async function createQuickTask(
  overrides: Partial<Prisma.WorkItemUncheckedCreateInput> = {},
) {
  const n = nextSeq()
  return prisma.workItem.create({
    data: {
      type: WorkItemType.QUICK_TASK,
      status: 'open',
      title: `Quick task ${n}`,
      description: 'A quick task',
      ...overrides,
    },
  })
}

export async function createSkill(overrides: Partial<Prisma.SkillUncheckedCreateInput> = {}) {
  const n = nextSeq()
  const category =
    overrides.categoryId !== undefined
      ? null
      : await prisma.skillCategory.create({ data: { name: `Category ${n}` } })
  return prisma.skill.create({
    data: { name: `Skill ${n}`, categoryId: category?.id ?? overrides.categoryId!, ...overrides },
  })
}

export async function createTeam(overrides: Partial<Prisma.TeamUncheckedCreateInput> = {}) {
  const n = nextSeq()
  return prisma.team.create({ data: { name: `Team ${n}`, ...overrides } })
}

export async function createLocalGroup(
  overrides: Partial<Prisma.LocalGroupUncheckedCreateInput> = {},
) {
  const n = nextSeq()
  return prisma.localGroup.create({ data: { name: `Group ${n}`, country: 'UK', ...overrides } })
}

/** Two volunteers who have accepted a contact request, so they may message each other. */
export function connect(a: { id: number }, b: { id: number }) {
  return prisma.contactRequest.create({
    data: {
      fromVolunteerId: a.id,
      toVolunteerId: b.id,
      message: 'We met at a meeting and would like to talk.',
      status: 'accepted',
      respondedAt: new Date(),
    },
  })
}
