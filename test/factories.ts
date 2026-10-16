import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { ApprovalStatus, WorkItemType, ProjectStatus } from '@/generated/prisma/enums'
import type { Prisma } from '@/generated/prisma/client'
import { COUNTRIES } from '@/lib/countries'
import { globalAdminEmail } from './admin-emails'

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

let adminSeq = 0
/** A global admin: an address listed in ADMIN_EMAILS (see test/setup-db.ts). */
export const createAdmin = (overrides: Partial<Prisma.VolunteerUncheckedCreateInput> = {}) =>
  createVolunteer({ isAdmin: true, email: globalAdminEmail(adminSeq++), ...overrides })

let superSeq = 0
/** A global admin at admin@example.com, admin1@example.com and so on. */
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
      status: 'not_started',
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

let chapterSeq = 0
/** A national chapter for the next listed country not yet used in this file. */
export async function createChapter(
  overrides: Partial<Prisma.NationalChapterUncheckedCreateInput> = {},
) {
  const listed = COUNTRIES[chapterSeq++]
  if (!listed) throw new Error('createChapter: every listed country already has a chapter')
  return prisma.nationalChapter.create({
    data: { country: listed.value, name: listed.label, ...overrides },
  })
}

/** A volunteer who belongs to `chapter`, with their country set to match. */
export const createMember = (
  chapter: { id: number; country: string },
  overrides: Partial<Prisma.VolunteerUncheckedCreateInput> = {},
) => createVolunteer({ nationalChapterId: chapter.id, country: chapter.country, ...overrides })

/** A member made the chapter's lead. */
export async function createChapterLead(
  chapter: { id: number; country: string },
  overrides: Partial<Prisma.VolunteerUncheckedCreateInput> = {},
) {
  const lead = await createMember(chapter, overrides)
  await prisma.nationalChapter.update({ where: { id: chapter.id }, data: { leadId: lead.id } })
  return lead
}

/** A member made one of the chapter's deputies. */
export async function createChapterDeputy(
  chapter: { id: number; country: string },
  overrides: Partial<Prisma.VolunteerUncheckedCreateInput> = {},
) {
  const deputy = await createMember(chapter, overrides)
  await prisma.chapterDeputy.create({
    data: { nationalChapterId: chapter.id, volunteerId: deputy.id },
  })
  return deputy
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
