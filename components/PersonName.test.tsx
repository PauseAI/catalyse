import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { failNextFetch, requestsTo } from '@/test/rpc-fetch'
import {
  createAdmin,
  createChapter,
  createChapterLead,
  createMember,
  createVolunteer,
} from '@/test/factories'
import PersonName from './PersonName'

const lookups = () => requestsTo('volunteers/lookup')

describe('PersonName', () => {
  it('links a name the viewer can open and badges a chapter lead', async () => {
    const chapter = await createChapter()
    const viewer = await createMember(chapter)
    const lead = await createChapterLead(chapter)
    await renderApp(<PersonName id={lead.id} name="Lee Lead" />, { as: viewer })
    expect(await screen.findByRole('link', { name: 'Lee Lead' })).toHaveAttribute(
      'href',
      `/volunteers/${lead.id}`,
    )
    expect(screen.getByText('Lead')).toHaveAttribute('title', `${chapter.name} chapter lead`)
  })

  it('leaves a hidden profile’s name as text, still badged', async () => {
    const viewer = await createVolunteer()
    const admin = await createAdmin({ consentMakeProfileVisibleInDirectory: false })
    await renderApp(<PersonName id={admin.id} name="Ada Admin" />, { as: viewer })
    expect(await screen.findByText('Admin')).toHaveAttribute('title', 'Global admin')
    expect(screen.getByText('Ada Admin')).not.toHaveAttribute('href')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('looks up every name on the page in one request', async () => {
    const viewer = await createVolunteer()
    const [a, b, c] = [await createVolunteer(), await createVolunteer(), await createVolunteer()]
    await renderApp(
      <>
        <PersonName id={a.id} name="A" />
        <PersonName id={b.id} name="B" />
        <PersonName id={c.id} name="C" />
        <PersonName id={a.id} name="A again" />
      </>,
      { as: viewer },
    )
    await screen.findByRole('link', { name: 'C' })
    expect(screen.getAllByRole('link')).toHaveLength(4)
    expect(lookups()).toHaveLength(1)
  })

  it('splits a page of more names than one request takes', async () => {
    const viewer = await createVolunteer()
    const ids = Array.from({ length: 201 }, (_, i) => 1_000_000 + i)
    await renderApp(
      <>
        {ids.map((id) => (
          <PersonName key={id} id={id} name={`Nobody ${id}`} />
        ))}
      </>,
      { as: viewer },
    )
    await waitFor(() => expect(lookups()).toHaveLength(2))
  })

  it('shows plain names, and asks nothing, when signed out or with no account', async () => {
    const someone = await createVolunteer()
    await renderApp(
      <>
        <PersonName id={someone.id} name="Signed out view" />
        <PersonName id={null} name="Deleted author" />
      </>,
    )
    expect(screen.getByText('Signed out view')).toBeInTheDocument()
    expect(screen.getByText('Deleted author')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(lookups()).toHaveLength(0)
  })

  it('shows the plain name when the lookup fails', async () => {
    const viewer = await createVolunteer()
    failNextFetch('volunteers/lookup')
    await renderApp(<PersonName id={viewer.id} name="Offline" />, { as: viewer })
    await waitFor(() => expect(lookups()).toHaveLength(1))
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
