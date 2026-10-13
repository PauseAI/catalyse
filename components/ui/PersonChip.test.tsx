import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyPersonChip, PersonChip } from './PersonChip'

describe('PersonChip', () => {
  it('shows initials and name, with no link or remove control by default', () => {
    const { container } = render(<PersonChip name="Ann Bee" />)
    expect(screen.getByText('Ann Bee')).toBeInTheDocument()
    expect(screen.getByText('AB')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container).toHaveTextContent(/^ABAnn Bee$/)
  })

  it('links the name when given an href', () => {
    render(<PersonChip name="Ann Bee" href="/volunteers/7" />)
    expect(screen.getByRole('link', { name: 'Ann Bee' })).toHaveAttribute('href', '/volunteers/7')
  })

  it('calls onRemove from a × labelled by the caller', async () => {
    const onRemove = vi.fn()
    render(<PersonChip name="Ann Bee" onRemove={onRemove} removeLabel="Remove Ann Bee" />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ann Bee' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('disables the × when asked', async () => {
    const onRemove = vi.fn()
    render(
      <PersonChip name="Ann Bee" onRemove={onRemove} removeLabel="Remove Ann Bee" removeDisabled />,
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
