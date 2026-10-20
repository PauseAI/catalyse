import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ThemeProvider, useTheme } from './ThemeProvider'
import { ThemeToggle } from './ThemeToggle'
import Modal from './ui/Modal'
import FloatingActions from './FloatingActions'
import SkillPicker from './SkillPicker'
import FilterDropdown, { useFilterOptions, type FilterOption } from './FilterDropdown'
import { renderApp } from '@/test/render'
import { createAdmin, createVolunteer } from '@/test/factories'
import { prisma } from '@/lib/prisma'
import { navigation } from '@/test/next-navigation'

function mockMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>()
  const mq = {
    matches: dark,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  window.matchMedia = vi.fn(() => mq) as never
  return {
    flip(nowDark: boolean) {
      mq.matches = nowDark
      listeners.forEach((l) => l())
    },
  }
}

describe('ThemeProvider / ThemeToggle', () => {
  function Probe() {
    const { theme, resolvedTheme, setTheme } = useTheme()
    return (
      <>
        <span data-testid="t">
          {theme}/{resolvedTheme ?? 'none'}
        </span>
        <button onClick={() => setTheme('system')}>system</button>
        <ThemeToggle />
      </>
    )
  }

  it('resolves from storage or system preference, toggles, and follows system changes', async () => {
    const media = mockMatchMedia(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('t')).toHaveTextContent('system/dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    await userEvent.click(screen.getByTitle('Switch to light mode'))
    expect(screen.getByTestId('t')).toHaveTextContent('light/light')
    expect(localStorage.getItem('theme')).toBe('light')
    // A system change is ignored while a theme is pinned...
    act(() => media.flip(false))
    expect(screen.getByTestId('t')).toHaveTextContent('light/light')
    await userEvent.click(screen.getByTitle('Switch to dark mode'))
    expect(screen.getByTestId('t')).toHaveTextContent('dark/dark')
    // ...and followed once back on system.
    await userEvent.click(screen.getByText('system'))
    expect(screen.getByTestId('t')).toHaveTextContent('system/light')
    act(() => media.flip(true))
    expect(screen.getByTestId('t')).toHaveTextContent('system/dark')
  })

  it('reads a stored theme on mount, and the toggle renders a placeholder without a provider', () => {
    mockMatchMedia(false)
    localStorage.setItem('theme', 'dark')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('t')).toHaveTextContent('dark/dark')
    const { container } = render(<ThemeToggle />)
    expect(container.querySelector('.w-8')).toBeInTheDocument()
  })
})

describe('Modal', () => {
  it('renders when open, closes on Escape, backdrop and the close button', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Modal id="m" title="Hello" isOpen={false} onClose={onClose}>
        body
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <Modal id="m" title="Hello" isOpen onClose={onClose} size="wide">
        <button>inside</button>
      </Modal>,
    )
    expect(screen.getByRole('dialog')).toHaveClass('max-w-3xl')
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('a')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByText('inside'))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('FloatingActions', () => {
  it('offers the theme toggle, dev toasts, and the bug dialog for signed-in users', async () => {
    mockMatchMedia(false)
    vi.stubEnv('NODE_ENV', 'development')
    const vol = await createVolunteer()
    await renderApp(
      <ThemeProvider>
        <FloatingActions />
      </ThemeProvider>,
      { as: vol },
    )
    await userEvent.click(screen.getByText('✓'))
    await userEvent.click(screen.getByText('✕'))
    await userEvent.click(screen.getByText('ℹ'))
    expect(screen.getAllByRole('alert')).toHaveLength(3)
    const bug = await screen.findByLabelText('Report a bug or give feedback')
    expect(bug.parentElement).toHaveClass('bottom-4')
    await userEvent.click(bug)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Close'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    vi.unstubAllEnvs()
  })

  it('hides dev toasts and the bug button outside development / when signed out', async () => {
    mockMatchMedia(false)
    vi.stubEnv('NODE_ENV', 'production')
    await renderApp(
      <ThemeProvider>
        <FloatingActions />
      </ThemeProvider>,
    )
    expect(screen.queryByText('✓')).toBeNull()
    expect(screen.queryByLabelText('Report a bug or give feedback')).toBeNull()
    vi.unstubAllEnvs()
  })

  it('lets an admin switch between the admin and volunteer views', async () => {
    mockMatchMedia(false)
    const admin = await createAdmin()
    await renderApp(
      <ThemeProvider>
        <FloatingActions />
      </ThemeProvider>,
      { as: admin, url: '/admin' },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Viewing as admin' }))
    const toVolunteer = await screen.findByRole('button', { name: 'Viewing as volunteer' })
    expect(toVolunteer).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('viewAs')).toBe('volunteer')
    expect(navigation.push).toHaveBeenCalledWith('/dashboard')

    await userEvent.click(toVolunteer)
    expect(await screen.findByRole('button', { name: 'Viewing as admin' })).toBeEnabled()
    expect(localStorage.getItem('viewAs')).toBeNull()
    expect(navigation.push).toHaveBeenCalledTimes(1)
  })

  it('offers no view switch to a volunteer', async () => {
    mockMatchMedia(false)
    await renderApp(
      <ThemeProvider>
        <FloatingActions />
      </ThemeProvider>,
      { as: await createVolunteer() },
    )
    await screen.findByLabelText('Report a bug or give feedback')
    expect(screen.queryByRole('button', { name: /^Viewing as/ })).toBeNull()
  })
})

describe('SkillPicker', () => {
  it('loads the catalogue and toggles skills with optional proficiency', async () => {
    const cat = await prisma.skillCategory.create({ data: { name: 'Zed cat', sortOrder: -1 } })
    const s1 = await prisma.skill.create({ data: { name: 'Zed skill', categoryId: cat.id } })
    function Host({ showProficiency }: { showProficiency?: boolean }) {
      const [value, setValue] = useState<{ skillId: number; proficiencyLevel: string }[]>([])
      return (
        <>
          <SkillPicker value={value} onChange={setValue} showProficiency={showProficiency} />
          <pre data-testid="v">{JSON.stringify(value)}</pre>
        </>
      )
    }
    await renderApp(<Host showProficiency />)
    expect(screen.getByText('Loading skills…')).toBeInTheDocument()
    const box = await screen.findByLabelText('Zed skill')
    await userEvent.click(box)
    expect(screen.getByTestId('v')).toHaveTextContent(
      `[{"skillId":${s1.id},"proficiencyLevel":"intermediate"}]`,
    )
    await userEvent.click(screen.getByLabelText('Proficiency'))
    await userEvent.click(screen.getByRole('option', { name: 'Expert' }))
    expect(screen.getByTestId('v')).toHaveTextContent('"expert"')
    await userEvent.click(box)
    expect(screen.getByTestId('v')).toHaveTextContent('[]')
  })
})

describe('FilterDropdown', () => {
  const options: FilterOption[] = [
    { value: '', label: 'Any' },
    { value: 'hdr', label: 'Group', header: true },
    { value: 'a', label: 'Apple', indent: true },
    { value: 'b', label: 'Banana' },
  ]
  function Host(props: Partial<React.ComponentProps<typeof FilterDropdown>>) {
    const state = useFilterOptions(options, '')
    return (
      <>
        <FilterDropdown id="f" label="Fruit" ariaLabel="Fruit" {...state} {...props} />
        <span data-testid="v">{state.value}</span>
        <button>outside</button>
      </>
    )
  }

  it('opens, selects by click, ignores headers, and closes on outside click', async () => {
    render(<Host required hideLabel renderOption={(o) => <em>{o.label}</em>} />)
    const trigger = screen.getByRole('button', { name: 'Fruit' })
    expect(screen.getByText('Fruit', { selector: 'label' })).toHaveClass(
      'sr-only',
      "after:content-['_*']",
    )
    await userEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Group'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Apple' }))
    expect(screen.getByTestId('v')).toHaveTextContent('a')
    expect(screen.queryByRole('listbox')).toBeNull()
    await userEvent.click(trigger)
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('listbox')).toBeNull()
    // Repositions on scroll/resize while open.
    await userEvent.click(trigger)
    act(() => {
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('supports full keyboard navigation', async () => {
    render(<Host />)
    const trigger = screen.getByRole('button', { name: 'Fruit' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(trigger).toHaveAttribute('aria-activedescendant', 'f-opt-2')
    await userEvent.keyboard('{Tab}')
    expect(trigger).toHaveAttribute('aria-activedescendant', 'f-opt-3')
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await userEvent.keyboard('{ArrowUp}')
    expect(trigger).toHaveAttribute('aria-activedescendant', 'f-opt-0')
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('listbox')).toBeNull()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('x')
  })

  it('cannot select a header even when keyboard focus lands on one', async () => {
    const headed: FilterOption[] = [
      { value: 'h', label: 'Head', header: true },
      { value: 'x', label: 'Ex' },
    ]
    function HeadedHost() {
      const state = useFilterOptions(headed, 'x')
      return <FilterDropdown id="h" label="H" ariaLabel="H" {...state} />
    }
    render(<HeadedHost />)
    screen.getByRole('button', { name: 'H' }).focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('filters when searchable, reports queries, and closes on backspace when empty', async () => {
    const onQueryChange = vi.fn()
    render(<Host searchable onQueryChange={onQueryChange} triggerClassName="pill" />)
    await userEvent.click(screen.getByRole('button', { name: 'Fruit' }))
    const input = screen.getByRole('searchbox')
    expect(input).toHaveFocus()
    await userEvent.type(input, 'ban')
    expect(onQueryChange).toHaveBeenLastCalledWith('ban')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await userEvent.type(input, 'zzz')
    expect(screen.getByText('No results')).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.keyboard('{Backspace}')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
