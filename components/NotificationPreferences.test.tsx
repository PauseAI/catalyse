import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NotificationPreferences from './NotificationPreferences'
import type { PreferenceRow } from '@/lib/notification-types'

const row = (type: string, category: PreferenceRow['category']): PreferenceRow => ({
  type,
  label: `Label ${type}`,
  category,
  delivery: 'email',
  fixed: null,
  staffOnly: false,
})

describe('NotificationPreferences', () => {
  it('leaves out a category with nothing in it, and a Set all for a lone choice', async () => {
    const onChange = vi.fn()
    render(<NotificationPreferences rows={[row('a', 'update')]} value={{}} onChange={onChange} />)
    expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Needs action' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Set all Updates' })).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: 'Digest' }))
    expect(onChange).toHaveBeenCalledWith({ a: 'digest' })
  })

  it('fills in every choice from a preset, and shows Custom once one is changed', async () => {
    const rows = [
      row('a', 'needs_action'),
      row('b', 'update'),
      { ...row('c', 'update'), fixed: { shows: 'In app only', why: 'Fixed.' } },
    ]
    let value: Record<string, 'in_app' | 'email' | 'digest'> = {}
    const { rerender } = render(
      <NotificationPreferences rows={rows} value={value} onChange={(v) => (value = v)} />,
    )
    const preset = (name: RegExp) => screen.getByRole('radio', { name })
    // Every row starts on Email.
    expect(preset(/^Everything by email/)).toBeChecked()
    await userEvent.click(preset(/^Recommended/))
    expect(value).toEqual({ a: 'email', b: 'digest' })
    rerender(<NotificationPreferences rows={rows} value={value} onChange={(v) => (value = v)} />)
    expect(preset(/^Recommended/)).toBeChecked()
    await userEvent.click(preset(/^In app only/))
    expect(value).toEqual({ a: 'in_app', b: 'in_app' })
    value = { ...value, b: 'digest' }
    rerender(<NotificationPreferences rows={rows} value={value} onChange={(v) => (value = v)} />)
    expect(preset(/^Custom/)).toBeChecked()
    expect(preset(/^Custom/)).toBeDisabled()
  })
})
