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
})
