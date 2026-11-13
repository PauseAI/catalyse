import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NotificationPreferences from './NotificationPreferences'
import type { Delivery, PreferenceRow, Role } from '@/lib/notification-types'

const row = (
  type: string,
  category: PreferenceRow['category'],
  role: Role = 'everyone',
): PreferenceRow => ({
  type,
  label: `Label ${type}`,
  category,
  delivery: 'email',
  fixed: null,
  role,
})

describe('NotificationPreferences', () => {
  it('leaves out a category with nothing in it, and a Set all for a lone choice', async () => {
    const onChange = vi.fn()
    render(
      <NotificationPreferences
        rows={[row('a', 'update')]}
        heldRoles={['everyone']}
        value={{}}
        onChange={onChange}
      />,
    )
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
    let value: Record<string, Delivery> = {}
    const props = {
      rows,
      heldRoles: ['everyone'] as Role[],
      onChange: (v: typeof value) => (value = v),
    }
    const { rerender } = render(<NotificationPreferences {...props} value={value} />)
    const preset = (name: RegExp) => screen.getByRole('radio', { name })
    // Every row starts on Email.
    expect(preset(/^Everything by email/)).toBeChecked()
    await userEvent.click(preset(/^Recommended/))
    expect(value).toEqual({ a: 'email', b: 'digest' })
    rerender(<NotificationPreferences {...props} value={value} />)
    expect(preset(/^Recommended/)).toBeChecked()
    await userEvent.click(preset(/^In app only/))
    expect(value).toEqual({ a: 'in_app', b: 'in_app' })
    value = { ...value, b: 'digest' }
    rerender(<NotificationPreferences {...props} value={value} />)
    expect(preset(/^Custom/)).toBeChecked()
    expect(preset(/^Custom/)).toBeDisabled()
  })

  it('groups types by role: held roles open, others muted and closed but settable', async () => {
    const rows = [
      row('basic', 'update'),
      row('lead1', 'needs_action', 'project_lead'),
      row('lead2', 'update', 'project_lead'),
      row('team', 'needs_action', 'team_lead'),
      row('coord', 'needs_action', 'coordinator'),
    ]
    let value: Record<string, Delivery> = {}
    const props = {
      rows,
      heldRoles: ['everyone', 'project_lead'] as Role[],
      onChange: (v: typeof value) => (value = v),
    }
    const { rerender } = render(<NotificationPreferences {...props} value={value} />)
    const section = (name: string) => screen.getByRole('button', { name: new RegExp(name) })

    const lead = section('If you lead a project')
    expect(lead).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('radiogroup', { name: 'Label lead1' })).toBeVisible()
    expect(screen.getByRole('radiogroup', { name: /^Set all If you lead a project/ })).toBeVisible()

    const team = section('If you lead a team')
    expect(team).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('radiogroup', { name: 'Label team' })).toBeNull()
    expect(screen.getAllByText(/You don't have this role right now/)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Chapter staff/ })).toBeNull()

    // A closed section opens and can be set ahead of time; an open one closes.
    await userEvent.click(team)
    expect(team).toHaveAttribute('aria-expanded', 'true')
    const teamChoices = screen.getByRole('radiogroup', { name: 'Label team' })
    await userEvent.click(within(teamChoices).getByRole('radio', { name: 'Digest' }))
    expect(value).toEqual({ team: 'digest' })
    await userEvent.click(lead)
    expect(lead).toHaveAttribute('aria-expanded', 'false')

    // A preset reaches every section, open or closed.
    rerender(<NotificationPreferences {...props} value={value} />)
    await userEvent.click(screen.getByRole('radio', { name: /^Recommended/ }))
    expect(value).toEqual({
      basic: 'digest',
      lead1: 'email',
      lead2: 'digest',
      team: 'email',
      coord: 'email',
    })
  })
})
