import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { authenticateApiToken, createApiToken } from '@/lib/api-tokens'
import { createAdmin } from '@/test/factories'
import { renderApp } from '@/test/render'
import AdminApiTokensPage from './page'

const pick = async (button: string, option: string) => {
  await userEvent.click(screen.getByRole('button', { name: button }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

describe('API tokens page', () => {
  it('creates a token, shows it once with how to connect, and lists it', async () => {
    const admin = await createAdmin()
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    await renderApp(<AdminApiTokensPage />, { as: admin })

    await screen.findByText('You have no tokens.')
    const create = screen.getByRole('button', { name: 'Create token' })
    expect(create).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Name'), 'Orca agents')
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Comment on bug reports and change their status' }),
    )
    await pick('Expires after', 'Never')
    await userEvent.click(create)

    const shown = await screen.findByRole('region', { name: 'New token' })
    const token = within(shown).getByText(/^cat_/).textContent!
    expect(await authenticateApiToken(`Bearer ${token}`)).toMatchObject({
      scopes: ['bug_reports:read'],
    })
    expect(shown).toHaveTextContent(
      `claude mcp add --transport http catalyse http://localhost:3000/api/mcp --header "Authorization: Bearer ${token}"`,
    )
    await userEvent.click(within(shown).getByRole('button', { name: 'Copy token' }))
    expect(writeText).toHaveBeenCalledWith(token)
    await screen.findByText('Token copied')

    const row = await screen.findByRole('listitem', { name: 'Orca agents' })
    expect(row).toHaveTextContent('Read bug reports and their comments')
    expect(row).toHaveTextContent(/Created .* · Never used · Never expires/)
    expect(screen.getByLabelText('Name')).toHaveValue('')

    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('region', { name: 'New token' })).not.toBeInTheDocument()
  })

  it('shows when a token was last used and when it expires', async () => {
    const admin = await createAdmin()
    const { id } = await createApiToken(admin.id, {
      name: 'Old script',
      scopes: ['bug_reports:read', 'bug_reports:write'],
      expiresAt: new Date('2027-01-15T12:00:00Z'),
    })
    await prisma.apiToken.update({
      where: { id },
      data: { lastUsedAt: new Date('2026-10-01T12:00:00Z') },
    })
    await renderApp(<AdminApiTokensPage />, { as: admin })

    const row = await screen.findByRole('listitem', { name: 'Old script' })
    expect(row).toHaveTextContent(
      'Read bug reports and their comments · Comment on bug reports and change their status',
    )
    expect(row).toHaveTextContent('Last used 1 October 2026 · Expires 15 January 2027')
  })

  it('revokes a token after asking, and says so if it is already gone', async () => {
    const admin = await createAdmin()
    const kept = await createApiToken(admin.id, {
      name: 'Keep me',
      scopes: ['bug_reports:read'],
      expiresAt: null,
    })
    await createApiToken(admin.id, {
      name: 'Drop me',
      scopes: ['bug_reports:read'],
      expiresAt: null,
    })
    await renderApp(<AdminApiTokensPage />, { as: admin })

    const revokeButton = async (name: string) =>
      within(await screen.findByRole('listitem', { name })).getByRole('button', { name: 'Revoke' })
    const confirm = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' })

    await userEvent.click(await revokeButton('Drop me'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(await revokeButton('Drop me'))
    expect(screen.getByText("Revoke 'Drop me'?")).toBeInTheDocument()
    await userEvent.click(confirm())
    await screen.findByText('Token revoked')
    await waitFor(() =>
      expect(screen.queryByRole('listitem', { name: 'Drop me' })).not.toBeInTheDocument(),
    )

    await prisma.apiToken.delete({ where: { id: kept.id } })
    await userEvent.click(await revokeButton('Keep me'))
    await userEvent.click(confirm())
    await screen.findByText('Token not found')
  })

  it('reports a name the server refuses', async () => {
    await renderApp(<AdminApiTokensPage />, { as: await createAdmin() })
    await screen.findByText('You have no tokens.')
    await userEvent.type(screen.getByLabelText('Name'), 'x'.repeat(101))
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await screen.findByText('Name must be 100 characters or fewer')
  })
})
