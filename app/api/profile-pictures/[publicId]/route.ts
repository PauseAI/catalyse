import { prisma } from '@/lib/prisma'
import { PICTURE_CONTENT_TYPE } from '@/lib/profile-picture'

/**
 * A profile picture by its random id. An `<img>` sends no bearer token, so the id is the only
 * secret: it reaches only the people shown the picture, and changes on every upload, which lets a
 * copy be cached for good.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await params
  const picture = await prisma.profilePicture.findUnique({
    where: { publicId },
    select: { data: true },
  })
  if (!picture) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(picture.data), {
    headers: {
      'Content-Type': PICTURE_CONTENT_TYPE,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
