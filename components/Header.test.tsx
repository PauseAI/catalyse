import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MutationObserver } from '@tanstack/react-query'
import { prisma } from '@/lib/prisma'
import { queryClient } from '@/lib/query-client'
import { createVolunteer, createAdmin, createSuperAdmin } from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import Header from './Header'
import { ThemeProvider } from './ThemeProvider'
import { LocationModalProvider, useLocationModal } from '@/lib/location-modal-context'

window.matchMedia = vi.fn(() => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
})) as never

function ModalFlag() {
  const { open } = useLocationModal()
  return <span data-testid="modal">{String(open)}</span>
}

const mount = (as: Awaited<ReturnType<typeof createVolunteer>> | null, url = '/projects') =>
  renderApp(
    <ThemeProvider>
      <LocationModalProvider>
        <Header />
        <ModalFlag />
      </LocationModalProvider>
    </ThemeProvider>,
    { as, url },
  )

/** The main nav's items, links and the Inbox button alike, in order. */
const navItems = (nav: HTMLElement) => Array.from(nav.querySelectorAll<HTMLElement>('a, button'))

describe('Header', () => {
  it('shows login/signup when signed out, on desktop and in the mobile menu', async () => {
    await mount(null, '/')
    expect(await screen.findByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Catalyse' })).toHaveAttribute('href', '/')
    await userEvent.click(screen.getByLabelText('Open menu'))
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getAllByRole('link', { name: 'Sign Up' })).toHaveLength(2)
    await userEvent.click(screen.getByLabelText('Close menu'))
    expect(document.body.style.overflow).toBe('')
  })

  it('shows nav, unread badge, user menu and admin links for a signed-in admin', async () => {
    const admin = await createSuperAdmin({ locationConfirmedAt: new Date() })
    await prisma.notification.create({
      data: { volunteerId: admin.id, type: 'mention', title: 't' },
    })
    await mount(admin, '/projects')
    const nameButton = await screen.findByRole('button', { name: new RegExp(admin.name) })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Inbox/ })).toHaveTextContent('1'),
    )
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveClass('bg-primary')
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'People' })).not.toHaveClass('bg-primary')
    expect(screen.getByRole('link', { name: 'Catalyse' })).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByText('Confirm your location')).toBeNull()
    await userEvent.click(nameButton)
    expect(screen.getByRole('link', { name: 'Superadmin panel' })).toHaveAttribute('href', '/admin')
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }))
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    // Mobile menu for an admin, then sign out from it.
    await userEvent.click(screen.getByLabelText('Open menu'))
    expect(screen.getByText('Super Admin')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/login'))
  })

  it('prompts to confirm location, opens the bug dialog, and signs out from the desktop menu', async () => {
    const vol = await createVolunteer({ locationConfirmedAt: null })
    await mount(vol, '/teams')
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm your location' }))
    expect(screen.getByTestId('modal')).toHaveTextContent('true')
    await userEvent.click(screen.getByLabelText('Report a bug or give feedback'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Close'))
    await userEvent.click(screen.getByLabelText('Open menu'))
    await userEvent.click(screen.getAllByRole('button', { name: 'Confirm your location' })[1])
    await userEvent.click(screen.getByLabelText('Open menu'))
    await userEvent.click(screen.getByRole('button', { name: 'Report bug/feedback' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Close'))
    const nameButton = screen.getByRole('button', { name: vol.name })
    await userEvent.click(nameButton)
    expect(screen.queryByText(/Admin panel/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/login'))
  })

  it('counts what needs action and unread messages in the Inbox badge, not updates', async () => {
    const vol = await createVolunteer({ locationConfirmedAt: new Date() })
    await prisma.notification.createMany({
      data: [
        { volunteerId: vol.id, type: 'project_approved', title: 'an update' },
        { volunteerId: vol.id, type: 'mention', title: 'act' },
        { volunteerId: vol.id, type: 'message_received', title: 'msg' },
      ],
    })
    await mount(vol, '/projects')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Inbox/ })).toHaveTextContent(
        'Inbox, waiting for you: 2',
      ),
    )
    // On mobile the menu button carries a dot while something is waiting.
    expect(screen.getByLabelText('Open menu').querySelector('span')).not.toBeNull()

    // Acting on something anywhere on the page refreshes the count.
    await prisma.notification.deleteMany({ where: { volunteerId: vol.id, type: 'mention' } })
    await act(() => new MutationObserver(queryClient, { mutationFn: async () => null }).mutate())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Inbox/ })).toHaveTextContent(
        'Inbox, waiting for you: 1',
      ),
    )
  })

  it('shows five items; the Inbox badge counts only what is waiting', async () => {
    const vol = await createVolunteer({ locationConfirmedAt: new Date() })
    await prisma.notification.create({
      data: { volunteerId: vol.id, type: 'project_approved', title: 'an update' },
    })
    await mount(vol, '/projects')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    await waitFor(() =>
      expect(navItems(nav).map((l) => l.textContent)).toEqual([
        'Home',
        'Projects',
        'Tasks',
        'People',
        'Inbox',
      ]),
    )
    // An update is unread but needs nothing, so no badge.
    expect(within(nav).getByRole('button', { name: 'Inbox' })).toHaveTextContent(/^Inbox$/)
    // On mobile the Inbox is a plain link.
    await userEvent.click(screen.getByLabelText('Open menu'))
    expect(screen.getByRole('link', { name: 'Inbox' })).toHaveAttribute('href', '/inbox')
  })

  it('opens recent notifications from the Inbox item, and closes them again', async () => {
    const vol = await createVolunteer({ locationConfirmedAt: new Date() })
    await mount(vol, '/projects')
    const inbox = await screen.findByRole('button', { name: 'Inbox' })
    await userEvent.click(inbox)
    let popover = await screen.findByRole('dialog', { name: 'Recent notifications' })
    expect(await within(popover).findByText('Nothing new.')).toBeInTheDocument()
    expect(inbox).toHaveAttribute('aria-expanded', 'true')
    // Clicking the trigger again toggles it shut; clicking inside keeps it open.
    await userEvent.click(inbox)
    expect(screen.queryByRole('dialog')).toBeNull()

    await prisma.notification.create({
      data: { volunteerId: vol.id, type: 'mention', title: 'Sam mentioned you', link: '/x' },
    })
    await userEvent.click(inbox)
    popover = await screen.findByRole('dialog', { name: 'Recent notifications' })
    expect(await within(popover).findByText('Sam mentioned you')).toBeInTheDocument()
    fireEvent.mouseDown(within(popover).getByText('Sam mentioned you'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(inbox)
    await screen.findByRole('dialog')
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(inbox)
    const open = await screen.findByRole('link', { name: 'Open inbox →' })
    expect(open).toHaveAttribute('href', '/inbox')
    await userEvent.click(open)
    expect(screen.queryByRole('dialog')).toBeNull()
    // Any navigation closes it too.
    await userEvent.click(inbox)
    await screen.findByRole('dialog')
    act(() => navigation.push('/teams'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it.each([
    ['/quick-tasks/5', 'Tasks'],
    ['/teams/2', 'People'],
    ['/suggest-team', 'People'],
    ['/templates', 'Projects'],
    ['/projects/gantt', 'Projects'],
    ['/volunteers', 'People'],
    ['/dashboard', 'Home'],
    ['/inbox', 'Inbox'],
  ])('marks the right item active on %s', async (url, label) => {
    const vol = await createVolunteer({ locationConfirmedAt: new Date() })
    await mount(vol, url)
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    await waitFor(() =>
      expect(navItems(nav).filter((l) => l.hasAttribute('aria-current'))).toEqual([
        navItems(nav).find((l) => l.textContent === label),
      ]),
    )
  })

  it('links to my own profile and Settings from both menus, and Privacy only from Settings', async () => {
    const vol = await createVolunteer({ locationConfirmedAt: new Date() })
    await mount(vol, '/projects')
    await userEvent.click(await screen.findByRole('button', { name: vol.name }))
    expect(screen.getByRole('link', { name: 'My profile' })).toHaveAttribute(
      'href',
      `/volunteers/${vol.id}`,
    )
    await userEvent.click(screen.getByRole('button', { name: vol.name }))
    await userEvent.click(screen.getByLabelText('Open menu'))
    expect(screen.getByRole('link', { name: 'My profile' })).toHaveAttribute(
      'href',
      `/volunteers/${vol.id}`,
    )
    expect(screen.queryByRole('link', { name: 'Privacy & Data' })).toBeNull()
  })

  it('shows a plain admin panel link for non-super admins', async () => {
    const admin = await createAdmin({ locationConfirmedAt: new Date() })
    await mount(admin, '/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: admin.name }))
    expect(screen.getByRole('link', { name: 'Admin panel' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Open menu'))
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Admin panel' })).toHaveLength(2)
  })

  it('closes the mobile menu on navigation', async () => {
    const vol = await createVolunteer({ locationConfirmedAt: new Date() })
    await mount(vol, '/dashboard')
    await userEvent.click(await screen.findByLabelText('Open menu'))
    act(() => navigation.push('/projects'))
    await waitFor(() => expect(screen.queryByLabelText('Close menu')).toBeNull())
  })
})
