import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'
import { createVolunteer } from '@/test/factories'
import { EmptyPersonChip, PersonChip } from './PersonChip'

describe('PersonChip', () => {
  it('shows initials and name, with no link or remove control for someone with no account', async () => {
    const { container } = await renderApp(<PersonChip id={null} name="Ann Bee" />)
    expect(screen.getByText('Ann Bee')).toBeInTheDocument()
    expect(screen.getByText('AB')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container).toHaveTextContent(/^ABAnn Bee$/)
  })

  it('links the name to a profile the viewer can open', async () => {
    const [viewer, ann] = [await createVolunteer(), await createVolunteer()]
    await renderApp(<PersonChip id={ann.id} name="Ann Bee" />, { as: viewer })
    expect(await screen.findByRole('link', { name: 'Ann Bee' })).toHaveAttribute(
      'href',
      `/volunteers/${ann.id}`,
    )
  })

  it('marks the viewer’s own chip with “(you)” after the name, inside the chip', async () => {
    const viewer = await createVolunteer()
    const { container } = await renderApp(<PersonChip id={viewer.id} name="Ann Bee" isViewer />, {
      as: viewer,
    })
    expect(await screen.findByRole('link', { name: 'Ann Bee' })).toBeInTheDocument()
    expect(container.firstElementChild).toHaveTextContent(/^ABAnn Bee\(you\)$/)
  })

  it('calls onRemove from a × labelled by the caller', async () => {
    const onRemove = vi.fn()
    await renderApp(
      <PersonChip id={null} name="Ann Bee" onRemove={onRemove} removeLabel="Remove Ann Bee" />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ann Bee' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('disables the × when asked', async () => {
    const onRemove = vi.fn()
    await renderApp(
      <PersonChip
        id={null}
        name="Ann Bee"
        onRemove={onRemove}
        removeLabel="Remove Ann Bee"
        removeDisabled
      />,
    )
    const button = screen.getByRole('button', { name: 'Remove Ann Bee' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onRemove).not.toHaveBeenCalled()
  })
})

describe('EmptyPersonChip', () => {
  it('shows the caller’s label and no initials', () => {
    const { container } = render(<EmptyPersonChip label="Unclaimed" />)
    expect(screen.getByText('Unclaimed')).toBeInTheDocument()
    expect(container).toHaveTextContent(/^Unclaimed$/)
    expect(container.querySelector('[aria-hidden="true"]')).toBeEmptyDOMElement()
  })
})
