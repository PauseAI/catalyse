import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { MAX_UPLOAD_BYTES } from '@/lib/profile-picture'
import { exportProfile } from '@/lib/data-export'
import { GET } from '@/app/api/profile-pictures/[publicId]/route'
import {
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createMember,
  createSuperAdmin,
  createVolunteer,
  TEST_PASSWORD,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'

async function photo(width = 600, height = 400, format: 'png' | 'jpeg' = 'png') {
  const data = await sharp({
    create: { width, height, channels: 3, background: '#c33' },
  })
    [format]()
    .toBuffer()
  return new File([new Uint8Array(data)], `me.${format}`, { type: `image/${format}` })
}

/** What the picture route serves at `url`. */
async function served(url: string) {
  const publicId = url.split('/').pop() as string
  return GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ publicId }) })
}

describe('profile pictures', () => {
  it('stores an upload as a square WebP thumbnail, served at a URL that changes on replace', async () => {
    const me = await createVolunteer()
    const c = clientAs(me)

    const { picture: first } = await c.profilePictures.upload({ file: await photo() })
    const response = await served(first)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
    expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 })

    const [person] = await c.volunteers.lookup({ ids: [me.id] })
    expect(person.picture).toBe(first)

    const { picture: second } = await c.profilePictures.upload({
      file: await photo(300, 900, 'jpeg'),
    })
    expect(second).not.toBe(first)
    expect((await served(first)).status).toBe(404)
    expect((await served(second)).status).toBe(200)
    expect(await prisma.profilePicture.count({ where: { volunteerId: me.id } })).toBe(1)

    expect(await c.profilePictures.remove()).toEqual({ message: 'Picture removed' })
    expect((await served(second)).status).toBe(404)
    const [after] = await c.volunteers.lookup({ ids: [me.id] })
    expect(after.picture).toBeNull()
  })

  it('refuses a file that is not an image, or is too large', async () => {
    const me = await createVolunteer()
    const c = clientAs(me)
    await expect(
      c.profilePictures.upload({
        file: new File(['<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>'], 'x.svg'),
      }),
    ).rejects.toMatchObject({ message: 'Upload a JPEG, PNG, WebP, GIF or AVIF image' })
    await expect(
      c.profilePictures.upload({
        file: new File(['not an image'], 'x.png', { type: 'image/png' }),
      }),
    ).rejects.toMatchObject({ message: 'Upload a JPEG, PNG, WebP, GIF or AVIF image' })
    const huge = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.png', { type: 'image/png' })
    await expect(c.profilePictures.upload({ file: huge })).rejects.toMatchObject({
      message: 'Pictures must be 5 MB or smaller',
    })
    // A JPEG cut off halfway passes the format check and fails to decode.
    const noise = await sharp({
      create: {
        width: 600,
        height: 400,
        channels: 3,
        background: '#000',
        noise: { type: 'gaussian', mean: 128, sigma: 30 },
      },
    })
      .jpeg()
      .toBuffer()
    const cut = new File([new Uint8Array(noise.subarray(0, noise.length / 2))], 'cut.jpeg')
    await expect(c.profilePictures.upload({ file: cut })).rejects.toMatchObject({
      message: 'That image could not be read',
    })
    expect(await prisma.profilePicture.count({ where: { volunteerId: me.id } })).toBe(0)
  })

  it("lets the volunteer's chapter staff take a picture down, and tells the volunteer", async () => {
    const chapter = await createChapter()
    const member = await createMember(chapter)
    const lead = await createChapterLead(chapter)
    const deputy = await createChapterDeputy(chapter)
    await clientAs(member).profilePictures.upload({ file: await photo() })

    // Staff of another chapter and other volunteers cannot.
    const elsewhere = await createChapterLead(await createChapter())
    await expect(
      clientAs(elsewhere).profilePictures.removeFor({ volunteerId: member.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      clientAs(await createMember(chapter)).profilePictures.removeFor({ volunteerId: member.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const profile = await clientAs(lead).volunteers.getById({ id: member.id })
    expect(profile.canRemovePicture).toBe(true)
    expect((await clientAs(member).volunteers.getById({ id: member.id })).canRemovePicture).toBe(
      false,
    )

    expect(await clientAs(deputy).profilePictures.removeFor({ volunteerId: member.id })).toEqual({
      message: 'Picture removed',
    })
    const [person] = await clientAs(lead).volunteers.lookup({ ids: [member.id] })
    expect(person.picture).toBeNull()
    expect(
      await prisma.chapterAuditEvent.findFirst({
        where: { action: 'PROFILE_PICTURE_REMOVED', targetVolunteerId: member.id },
      }),
    ).toMatchObject({ actorId: deputy.id, nationalChapterId: chapter.id })
    expect(
      await prisma.notification.findFirst({
        where: { volunteerId: member.id, type: 'profile_picture_removed' },
      }),
    ).toMatchObject({ title: 'Your profile picture was removed', link: '/settings' })

    await expect(
      clientAs(lead).profilePictures.removeFor({ volunteerId: member.id }),
    ).rejects.toMatchObject({ message: 'They have no picture' })
  })

  it('lets a global admin take down anyone’s picture, the holding pool’s included', async () => {
    const pooled = await createVolunteer({ nationalChapterId: null })
    await clientAs(pooled).profilePictures.upload({ file: await photo() })
    await expect(
      clientAs(await createChapterLead(await createChapter())).profilePictures.removeFor({
        volunteerId: pooled.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await clientAs(await createSuperAdmin()).profilePictures.removeFor({ volunteerId: pooled.id })
    expect(await prisma.profilePicture.count({ where: { volunteerId: pooled.id } })).toBe(0)
  })

  it('is exported with the account, and deleted with it', async () => {
    const me = await createVolunteer()
    const c = clientAs(me)
    await c.profilePictures.upload({ file: await photo() })

    const exported = await exportProfile(me.id)
    expect(exported?.profilePicture?.image).toMatch(/^data:image\/webp;base64,/)

    await c.auth.deleteAccount({ password: TEST_PASSWORD })
    expect(await prisma.profilePicture.count({ where: { volunteerId: me.id } })).toBe(0)
    expect((await exportProfile(me.id))?.profilePicture).toBeNull()
  })
})
