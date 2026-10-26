import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { canAdminChapter } from '@/lib/chapter-access'
import { audit } from '@/lib/chapter-roles'
import { notifyUser } from '@/lib/notify'
import { profilePictureUrl } from '@/lib/profile-picture'
import { newPublicId, toProfilePicture } from '@/lib/profile-picture-server'
import { ChapterAuditAction } from '@/generated/prisma/enums'
import { authedProcedure, staffProcedure } from '../procedures'

export const profilePicturesRouter = {
  /** Replaces the caller's picture; the old one's URL stops working. */
  upload: authedProcedure
    .input(z.object({ file: z.instanceof(File, { message: 'Choose a picture to upload' }) }))
    .handler(async ({ input, context }) => {
      const data = await toProfilePicture(input.file)
      const publicId = newPublicId()
      const volunteerId = context.volunteer.id
      await prisma.profilePicture.upsert({
        where: { volunteerId },
        create: { volunteerId, publicId, data },
        update: { publicId, data, createdAt: new Date() },
      })
      return { picture: profilePictureUrl(publicId) }
    }),

  remove: authedProcedure.handler(async ({ context }) => {
    await prisma.profilePicture.deleteMany({ where: { volunteerId: context.volunteer.id } })
    return { message: 'Picture removed' }
  }),

  /**
   * Takes down someone else's picture, leaving their initials, for a global admin or the staff
   * of the volunteer's chapter. The volunteer is told, and it is written to the chapter audit log.
   */
  removeFor: staffProcedure
    .input(z.object({ volunteerId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const target = await prisma.volunteer.findFirst({
        where: { id: input.volunteerId, deletedAt: null },
        select: { id: true, nationalChapterId: true },
      })
      if (!target || !canAdminChapter(context.access, target.nationalChapterId)) {
        throw new ORPCError('NOT_FOUND', { message: 'Volunteer not found' })
      }
      const removed = await prisma.$transaction(async (tx) => {
        const { count } = await tx.profilePicture.deleteMany({ where: { volunteerId: target.id } })
        if (count) {
          await audit(tx, ChapterAuditAction.PROFILE_PICTURE_REMOVED, {
            actorId: context.volunteer.id,
            chapterId: target.nationalChapterId,
            targetVolunteerId: target.id,
          })
        }
        return count > 0
      })
      if (!removed) throw new ORPCError('BAD_REQUEST', { message: 'They have no picture' })
      await notifyUser(
        target.id,
        'profile_picture_removed',
        'Your profile picture was removed',
        'A moderator took it down. You can upload a different one from your settings.',
        '/settings',
      )
      return { message: 'Picture removed' }
    }),
}
