import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { MAX_UPLOAD_BYTES } from '@/lib/profile-picture'
import { createVolunteer } from '@/test/factories'
import { renderApp } from '@/test/render'
import ProfilePictureSettings from './ProfilePictureSettings'

const fileInput = () => screen.getByLabelText('Profile picture file')
const pictureOf = (volunteerId: number) =>
  prisma.profilePicture.findUnique({ where: { volunteerId } })

describe('ProfilePictureSettings', () => {
  it('uploads, replaces and removes the picture', async () => {
    const me = await createVolunteer({ name: 'Uma Uploader' })
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#36c' } })
      .png()
      .toBuffer()
    await renderApp(<ProfilePictureSettings id={me.id} name={me.name} />, { as: me })
    expect(await screen.findByRole('button', { name: 'Upload picture' })).toBeInTheDocument()

    await userEvent.upload(
      fileInput(),
      new File([new Uint8Array(png)], 'me.png', { type: 'image/png' }),
    )
    expect(await screen.findByText('Picture updated')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Change picture' })).toBeInTheDocument()
    const stored = await pictureOf(me.id)
    expect(document.querySelector(`img[src$="${stored?.publicId}"]`)).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Picture removed')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Upload picture' })).toBeInTheDocument()
    expect(await pictureOf(me.id)).toBeNull()
  })

  it('says why a file is refused', async () => {
    const me = await createVolunteer()
    await renderApp(<ProfilePictureSettings id={me.id} name={me.name} />, { as: me })
    await screen.findByRole('button', { name: 'Upload picture' })
    // The button opens the file picker; closing it without choosing anything does nothing.
    const opened = vi.fn()
    fileInput().addEventListener('click', opened)
    await userEvent.click(screen.getByRole('button', { name: 'Upload picture' }))
    expect(opened).toHaveBeenCalled()
    fireEvent.change(fileInput())

    const huge = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'huge.png', { type: 'image/png' })
    await userEvent.upload(fileInput(), huge)
    expect(await screen.findByText('Pictures must be 5 MB or smaller')).toBeInTheDocument()

    await userEvent.upload(
      fileInput(),
      new File(['not a picture'], 'fake.png', { type: 'image/png' }),
    )
    expect(
      await screen.findByText('Upload a JPEG, PNG, WebP, GIF or AVIF image'),
    ).toBeInTheDocument()
    await waitFor(async () => expect(await pictureOf(me.id)).toBeNull())
  })
})
