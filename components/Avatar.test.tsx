import { describe, it, expect } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { prisma } from '@/lib/prisma'
import { profilePictureUrl } from '@/lib/profile-picture'
import { createVolunteer } from '@/test/factories'
import { renderApp } from '@/test/render'
import Avatar from './Avatar'

async function withPicture(publicId: string) {
  const v = await createVolunteer()
  await prisma.profilePicture.create({
    data: { volunteerId: v.id, publicId, data: new Uint8Array([1]) },
  })
  return v
}

describe('Avatar', () => {
  it('shows the picture when there is one, and initials otherwise or when it fails to load', async () => {
    const viewer = await createVolunteer()
    const pictured = await withPicture('avatar-test-picture')
    const { container } = await renderApp(
      <>
        <Avatar id={pictured.id} name="Pia Pictured" size="lg" label="Pia's picture" />
        <Avatar id={viewer.id} name="Ian Initials" />
        <Avatar id={null} name="Gone Away" size="xs" />
      </>,
      { as: viewer },
    )
    const picture = await screen.findByRole('img', { name: "Pia's picture" })
    const img = picture.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(profilePictureUrl('avatar-test-picture'))
    expect(container).toHaveTextContent('II')
    expect(container).toHaveTextContent('GA')

    fireEvent.error(img)
    expect(await screen.findByRole('img', { name: "Pia's picture" })).toHaveTextContent('PP')
  })
})
