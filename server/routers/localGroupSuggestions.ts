import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { LocalGroupSuggestionBodySchema } from '@/lib/schemas'
import { notifyChapterStaff } from '@/lib/notify'
import { authedProcedure, approvedProcedure } from '../procedures'

export const localGroupSuggestionsRouter = {
  list: authedProcedure.handler(async ({ context }) => {
    const suggestions = await prisma.localGroupSuggestion.findMany({
      where: { suggestedById: context.volunteer.id },
      orderBy: { createdAt: 'desc' },
      include: { mergedInto: { select: { id: true, name: true } } },
    })
    return {
      suggestions: suggestions.map((s) => ({
        id: s.id,
        name: s.name,
        country: s.country,
        status: s.status,
        adminNotes: s.adminNotes,
        createdAt: s.createdAt,
        mergedInto: s.mergedInto ? { id: s.mergedInto.id, name: s.mergedInto.name } : null,
      })),
    }
  }),

  create: approvedProcedure
    .input(LocalGroupSuggestionBodySchema)
    .handler(async ({ input, context }) => {
      // A member suggests a group for their own chapter; someone in the pool names any listed
      // country, enabled or not, since a group there is how a new country gets asked for.
      const chapter = context.access.chapterId
        ? await prisma.nationalChapter.findUniqueOrThrow({
            where: { id: context.access.chapterId },
          })
        : null
      const listed = await prisma.country.findUnique({
        where: { code: chapter?.country ?? input.country },
      })
      if (!listed) throw new ORPCError('BAD_REQUEST', { message: 'Invalid country' })
      const country = listed.code

      const suggestion = await prisma.localGroupSuggestion.create({
        data: {
          name: input.name,
          country,
          nationalChapterId: chapter?.id ?? null,
          suggestedById: context.volunteer.id,
        },
      })

      await notifyChapterStaff(
        suggestion.nationalChapterId,
        'local_group_suggestion',
        `New local group suggestion: ${listed.name}, ${input.name}`,
        null,
        '/admin/local-groups',
        undefined,
        suggestion.id,
      )

      return {
        id: suggestion.id,
        name: suggestion.name,
        country: suggestion.country,
        status: suggestion.status,
        adminNotes: null,
        createdAt: suggestion.createdAt,
        mergedInto: null,
      }
    }),
}
