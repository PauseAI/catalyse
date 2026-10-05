import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { clearNotifications, notifyUser } from '@/lib/notify'
import { html } from '@/lib/email'
import { TeamBodySchema } from '@/lib/schemas'
import { authedProcedure, approvedProcedure } from '../procedures'
import { contactRelations, type ContactRelations } from '@/lib/contact'
import { ADVERTISABLE_STATUSES } from '@/lib/project-status'
import { TeamMembershipRole, TeamJoinRequestStatus, WorkItemType } from '@/generated/prisma/enums'

const leaderIds = (teams: { members: { volunteerId: number; role: TeamMembershipRole }[] }[]) =>
  teams.flatMap((t) =>
    t.members.filter((m) => m.role === TeamMembershipRole.leader).map((m) => m.volunteerId),
  )

function serializeTeam(
  team: {
    id: number
    name: string
    description: string | null
    lumaUrl: string | null
    docUrl: string | null
    members: {
      volunteerId: number
      role: TeamMembershipRole
      volunteer: { id: number; name: string; consentMakeProfileVisibleInDirectory: boolean | null }
    }[]
    workItems?: { id: number; title: string; status: string }[]
  },
  relations: ContactRelations,
  viewerId?: number,
  viewerRequestStatus?: TeamJoinRequestStatus | null,
  viewerIsAdmin?: boolean,
) {
  const viewerMembership = viewerId
    ? team.members.find((m) => m.volunteerId === viewerId)
    : undefined
  // Meeting calendar and doc are for accepted members and admins only — not a public
  // recruitment page, and not visible while an application is merely pending.
  const isPrivy = Boolean(viewerMembership) || Boolean(viewerIsAdmin)
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    lumaUrl: isPrivy ? team.lumaUrl : null,
    docUrl: isPrivy ? team.docUrl : null,
    memberCount: team.members.length,
    leaders: team.members
      .filter((m) => m.role === TeamMembershipRole.leader)
      .map((m) => ({
        id: m.volunteer.id,
        name: m.volunteer.name,
        canMessage: m.volunteer.id !== viewerId && relations.reachable.has(m.volunteer.id),
        canRequestContact:
          m.volunteer.id !== viewerId &&
          !relations.reachable.has(m.volunteer.id) &&
          Boolean(m.volunteer.consentMakeProfileVisibleInDirectory),
        contactRequested: relations.requested.has(m.volunteer.id),
      })),
    // Who is in the team and what it runs are for its members and admins.
    members: isPrivy
      ? team.members.map((m) => ({ id: m.volunteer.id, name: m.volunteer.name, role: m.role }))
      : [],
    projects: isPrivy ? (team.workItems ?? []) : [],
    viewerRole: viewerMembership?.role ?? null,
    viewerRequestStatus: viewerRequestStatus ?? null,
  }
}

/** Team leader (of this team) or admin — who may review join requests / manage membership. */
async function assertCanManageTeam(
  teamId: number,
  volunteer: { id: number; isAdmin: boolean | null },
) {
  if (volunteer.isAdmin) return
  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_volunteerId: { teamId, volunteerId: volunteer.id } },
  })
  if (membership?.role !== TeamMembershipRole.leader) {
    throw new ORPCError('FORBIDDEN', { message: 'Only a team leader or admin can do this' })
  }
}

export const teamsRouter = {
  list: authedProcedure.handler(async ({ context }) => {
    const teams = await prisma.team.findMany({
      orderBy: { name: 'asc' },
      include: {
        members: {
          include: {
            volunteer: {
              select: { id: true, name: true, consentMakeProfileVisibleInDirectory: true },
            },
          },
        },
      },
    })
    const viewerId = context.volunteer?.id
    const pendingRequests = viewerId
      ? await prisma.teamJoinRequest.findMany({
          where: { volunteerId: viewerId, status: TeamJoinRequestStatus.pending },
          select: { teamId: true, status: true },
        })
      : []
    const pendingByTeam = new Map(pendingRequests.map((r) => [r.teamId, r.status]))
    const viewerIsAdmin = Boolean(context.volunteer?.isAdmin)
    const relations = await contactRelations(context.volunteer, leaderIds(teams))
    return {
      teams: teams.map((t) =>
        serializeTeam(t, relations, viewerId, pendingByTeam.get(t.id) ?? null, viewerIsAdmin),
      ),
    }
  }),

  getById: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const team = await prisma.team.findUnique({
        where: { id: input.id },
        include: {
          members: {
            include: {
              volunteer: {
                select: { id: true, name: true, consentMakeProfileVisibleInDirectory: true },
              },
            },
          },
          workItems: {
            where: { type: WorkItemType.PROJECT, status: { in: ADVERTISABLE_STATUSES } },
            select: { id: true, title: true, status: true },
            orderBy: { title: 'asc' },
          },
        },
      })
      if (!team) throw new ORPCError('NOT_FOUND', { message: 'Team not found' })
      const viewerId = context.volunteer?.id
      const pending = viewerId
        ? await prisma.teamJoinRequest.findFirst({
            where: {
              teamId: input.id,
              volunteerId: viewerId,
              status: TeamJoinRequestStatus.pending,
            },
          })
        : null
      return serializeTeam(
        team,
        await contactRelations(context.volunteer, leaderIds([team])),
        viewerId,
        pending?.status ?? null,
        Boolean(context.volunteer?.isAdmin),
      )
    }),

  /** Full team detail for management — admin or that team's leader only. */
  getManageable: approvedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await assertCanManageTeam(input.id, context.volunteer)
      const team = await prisma.team.findUnique({
        where: { id: input.id },
        include: {
          members: { include: { volunteer: { select: { id: true, name: true, email: true } } } },
        },
      })
      if (!team) throw new ORPCError('NOT_FOUND', { message: 'Team not found' })
      return {
        id: team.id,
        name: team.name,
        description: team.description,
        lumaUrl: team.lumaUrl,
        docUrl: team.docUrl,
        members: team.members.map((m) => ({
          id: m.volunteer.id,
          name: m.volunteer.name,
          email: m.volunteer.email,
          role: m.role,
        })),
      }
    }),

  /** Edit team details — admin or that team's leader only. Deleting a team stays admin-only. */
  update: approvedProcedure
    .input(z.object({ id: z.number().int() }).merge(TeamBodySchema))
    .handler(async ({ input, context }) => {
      await assertCanManageTeam(input.id, context.volunteer)
      const existing = await prisma.team.findUnique({ where: { id: input.id } })
      if (!existing) throw new ORPCError('NOT_FOUND', { message: 'Team not found' })

      const team = await prisma.team.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description ?? null,
          lumaUrl: input.lumaUrl ?? null,
          docUrl: input.docUrl ?? null,
        },
      })
      return { id: team.id, name: team.name }
    }),

  apply: approvedProcedure
    .input(z.object({ id: z.number().int(), message: z.string().optional() }))
    .handler(async ({ input, context }) => {
      const team = await prisma.team.findUnique({ where: { id: input.id } })
      if (!team) throw new ORPCError('NOT_FOUND', { message: 'Team not found' })

      const existingMembership = await prisma.teamMembership.findUnique({
        where: { teamId_volunteerId: { teamId: input.id, volunteerId: context.volunteer.id } },
      })
      if (existingMembership) {
        throw new ORPCError('BAD_REQUEST', { message: 'Already a member of this team' })
      }

      const existingRequest = await prisma.teamJoinRequest.findFirst({
        where: {
          teamId: input.id,
          volunteerId: context.volunteer.id,
          status: TeamJoinRequestStatus.pending,
        },
      })
      if (existingRequest) {
        throw new ORPCError('BAD_REQUEST', { message: 'Already applied, awaiting review' })
      }

      const joinRequest = await prisma.teamJoinRequest.create({
        data: {
          teamId: input.id,
          volunteerId: context.volunteer.id,
          message: input.message?.trim() || null,
        },
      })

      const leaders = await prisma.teamMembership.findMany({
        where: { teamId: input.id, role: TeamMembershipRole.leader },
        select: { volunteerId: true },
      })
      const recipientIds = leaders.length > 0 ? leaders.map((l) => l.volunteerId) : null
      if (recipientIds) {
        const title = `${context.volunteer.name} applied to join ${team.name}`
        await Promise.all(
          recipientIds.map((id) =>
            notifyUser(
              id,
              'team_join_request',
              title,
              null,
              `/admin/teams/${input.id}`,
              {
                subject: title,
                message: input.message
                  ? html`${context.volunteer.name} applied to join <strong>${team.name}</strong>:
                      "${input.message.trim()}"`
                  : html`${context.volunteer.name} applied to join <strong>${team.name}</strong>.`,
                ctaLabel: 'Review Application',
                ctaUrl: `/admin/teams/${input.id}`,
              },
              joinRequest.id,
            ),
          ),
        )
      }

      return { message: 'Application submitted' }
    }),

  leave: approvedProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await prisma.teamMembership.deleteMany({
        where: { teamId: input.id, volunteerId: context.volunteer.id },
      })
      return { message: 'Left team' }
    }),

  listJoinRequests: approvedProcedure
    .input(z.object({ teamId: z.number().int() }))
    .handler(async ({ input, context }) => {
      await assertCanManageTeam(input.teamId, context.volunteer)
      const requests = await prisma.teamJoinRequest.findMany({
        where: { teamId: input.teamId, status: TeamJoinRequestStatus.pending },
        orderBy: { createdAt: 'asc' },
        include: { volunteer: { select: { id: true, name: true, email: true } } },
      })
      return {
        requests: requests.map((r) => ({
          id: r.id,
          message: r.message,
          createdAt: r.createdAt,
          volunteer: { id: r.volunteer.id, name: r.volunteer.name, email: r.volunteer.email },
        })),
      }
    }),

  reviewJoinRequest: approvedProcedure
    .input(z.object({ id: z.number().int(), action: z.enum(['accept', 'decline']) }))
    .handler(async ({ input, context }) => {
      const request = await prisma.teamJoinRequest.findUnique({ where: { id: input.id } })
      if (!request) throw new ORPCError('NOT_FOUND', { message: 'Request not found' })
      await assertCanManageTeam(request.teamId, context.volunteer)

      if (request.status !== TeamJoinRequestStatus.pending) {
        throw new ORPCError('BAD_REQUEST', { message: 'Request already reviewed' })
      }

      await prisma.$transaction([
        prisma.teamJoinRequest.update({
          where: { id: input.id },
          data: {
            status:
              input.action === 'accept'
                ? TeamJoinRequestStatus.accepted
                : TeamJoinRequestStatus.declined,
            reviewedById: context.volunteer.id,
            reviewedAt: new Date(),
          },
        }),
        ...(input.action === 'accept'
          ? [
              prisma.teamMembership.upsert({
                where: {
                  teamId_volunteerId: { teamId: request.teamId, volunteerId: request.volunteerId },
                },
                create: { teamId: request.teamId, volunteerId: request.volunteerId },
                update: {},
              }),
            ]
          : []),
      ])

      // Every leader was told; once one answers, the request leaves each of their inboxes.
      await clearNotifications('team_join_request', request.id)
      const team = await prisma.team.findUnique({ where: { id: request.teamId } })
      await notifyUser(
        request.volunteerId,
        'team_join_request_reviewed',
        input.action === 'accept'
          ? `Approved: you've joined ${team?.name ?? 'the team'}`
          : `Declined: your request to join ${team?.name ?? 'the team'}`,
        null,
        `/teams/${request.teamId}`,
      )

      return { message: `Request ${input.action === 'accept' ? 'accepted' : 'declined'}` }
    }),

  /** Admin or team leader adds a volunteer directly — skips the apply/review flow. */
  assignMember: approvedProcedure
    .input(
      z.object({
        teamId: z.number().int(),
        volunteerId: z.number().int(),
        role: z.enum([TeamMembershipRole.member, TeamMembershipRole.leader]).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      await assertCanManageTeam(input.teamId, context.volunteer)
      const volunteer = await prisma.volunteer.findUnique({ where: { id: input.volunteerId } })
      if (!volunteer) throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })

      // Prisma only issues a single, race-safe `INSERT … ON CONFLICT` when `update` has
      // something to set; an empty update falls back to select-then-insert, which two
      // concurrent requests can both pass.
      if (input.role) {
        await prisma.teamMembership.upsert({
          where: { teamId_volunteerId: { teamId: input.teamId, volunteerId: input.volunteerId } },
          create: { teamId: input.teamId, volunteerId: input.volunteerId, role: input.role },
          update: { role: input.role },
        })
      } else {
        await prisma.teamMembership.createMany({
          data: { teamId: input.teamId, volunteerId: input.volunteerId },
          skipDuplicates: true,
        })
      }
      return { message: 'Volunteer added to team' }
    }),

  setMemberRole: approvedProcedure
    .input(
      z.object({
        teamId: z.number().int(),
        volunteerId: z.number().int(),
        role: z.enum([TeamMembershipRole.member, TeamMembershipRole.leader]),
      }),
    )
    .handler(async ({ input, context }) => {
      await assertCanManageTeam(input.teamId, context.volunteer)
      const membership = await prisma.teamMembership.findUnique({
        where: { teamId_volunteerId: { teamId: input.teamId, volunteerId: input.volunteerId } },
      })
      if (!membership) throw new ORPCError('NOT_FOUND', { message: 'Not a team member' })

      await prisma.teamMembership.update({
        where: { id: membership.id },
        data: { role: input.role },
      })
      return { message: 'Role updated' }
    }),

  removeMember: approvedProcedure
    .input(z.object({ teamId: z.number().int(), volunteerId: z.number().int() }))
    .handler(async ({ input, context }) => {
      await assertCanManageTeam(input.teamId, context.volunteer)
      await prisma.teamMembership.deleteMany({
        where: { teamId: input.teamId, volunteerId: input.volunteerId },
      })
      return { message: 'Member removed' }
    }),
}
