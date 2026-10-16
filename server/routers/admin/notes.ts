import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { CreateNoteSchema, UpdateNoteSchema } from '@/lib/schemas'
import { staffProcedure } from '../../procedures'
import { canAdminChapter, type ChapterAccess } from '@/lib/chapter-access'

/** Throws unless the volunteer is in a chapter the caller runs. */
async function assertRunsVolunteer(access: ChapterAccess, volunteerId: number) {
  const target = await prisma.volunteer.findUnique({
    where: { id: volunteerId },
    select: { nationalChapterId: true },
  })
  if (!target || !canAdminChapter(access, target.nationalChapterId)) {
    throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })
  }
}

/** Notes about a volunteer, kept by the staff of their chapter and the global admins. */
export const adminNotesRouter = {
  listForVolunteer: staffProcedure
    .input(z.object({ volunteerId: z.number().int() }))
    .handler(async ({ input, context }) => {
      await assertRunsVolunteer(context.access, input.volunteerId)
      const notes = await prisma.adminNote.findMany({
        where: { volunteerId: input.volunteerId },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return notes.map((n) => ({
        id: n.id,
        volunteerId: n.volunteerId,
        authorId: n.authorId,
        content: n.content,
        category: n.category,
        relatedProjectId: n.relatedWorkItemId,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        authorName: n.author.name,
      }))
    }),

  create: staffProcedure
    .input(z.object({ volunteerId: z.number().int() }).merge(CreateNoteSchema))
    .handler(async ({ input, context }) => {
      await assertRunsVolunteer(context.access, input.volunteerId)

      const note = await prisma.adminNote.create({
        data: {
          volunteerId: input.volunteerId,
          authorId: context.volunteer.id,
          content: input.content.trim(),
          category: input.category ?? 'general',
          relatedWorkItemId: input.relatedWorkItemId ?? null,
        },
      })
      return { id: note.id, message: 'Note added' }
    }),

  update: staffProcedure
    .input(z.object({ id: z.number().int() }).merge(UpdateNoteSchema))
    .handler(async ({ input, context }) => {
      const note = await prisma.adminNote.findUnique({ where: { id: input.id } })
      if (!note) throw new ORPCError('NOT_FOUND', { message: 'Note not found' })
      await assertRunsVolunteer(context.access, note.volunteerId)

      const data: Record<string, unknown> = { updatedAt: new Date() }
      if (input.content !== undefined) data.content = input.content
      if (input.category !== undefined) data.category = input.category

      await prisma.adminNote.update({ where: { id: input.id }, data })
      return { message: 'Note updated' }
    }),

  delete: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const note = await prisma.adminNote.findUnique({ where: { id: input.id } })
      if (!note) throw new ORPCError('NOT_FOUND', { message: 'Note not found' })
      await assertRunsVolunteer(context.access, note.volunteerId)
      await prisma.adminNote.delete({ where: { id: input.id } })
      return { message: 'Note deleted' }
    }),
}
