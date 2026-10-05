import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatusSplitButton from './StatusSplitButton'

const options = [
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
]

describe('StatusSplitButton', () => {
  it('shows the status, and picks another from the caret by click or keyboard', async () => {
    const onSelect = vi.fn()
    render(<StatusSplitButton value="in_progress" options={options} onSelect={onSelect} />)
    const caret = screen.getByRole('button', { name: 'project status' })
    expect(caret).toHaveTextContent('In Progress')
    expect(caret).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(caret)
    expect(screen.getByRole('option', { name: 'In Progress' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.click(screen.getByRole('option', { name: 'On Hold' }))
    expect(onSelect).toHaveBeenLastCalledWith('on_hold')
    expect(screen.queryByRole('listbox')).toBeNull()

    await userEvent.click(caret)
    fireEvent.keyDown(screen.getByRole('option', { name: 'On Hold' }), { key: 'x' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('option', { name: 'On Hold' }), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on Escape or a click outside, and can be disabled', async () => {
    const { rerender } = render(
      <StatusSplitButton value="on_hold" options={options} onSelect={() => {}} />,
    )
    const caret = screen.getByRole('button', { name: 'project status' })
    await userEvent.click(caret)
    await userEvent.keyboard('{Shift}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    await userEvent.click(caret)
    fireEvent.mouseDown(screen.getByRole('listbox'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
    rerender(<StatusSplitButton value="on_hold" options={options} onSelect={() => {}} disabled />)
    expect(screen.getByRole('button', { name: 'project status' })).toBeDisabled()
  })
})
