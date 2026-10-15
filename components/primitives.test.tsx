import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Button from './Button'
import { Badge, StatusFlag, badgeClasses, badgeColorClasses } from './Badge'
import Toggle from './Toggle'
import Radio from './Radio'
import Checkbox from './Checkbox'
import Alert from './ui/Alert'
import ConfirmDialog from './ui/ConfirmDialog'
import DescriptionTips from './DescriptionTips'
import Tooltip, { placeTip } from './Tooltip'
import Tabs from './Tabs'
import Skeleton from './Skeleton'
import EmptyState from './EmptyState'
import Providers from './Providers'
import LandingCTA from './LandingCTA'
import { renderApp } from '@/test/render'
import { createVolunteer } from '@/test/factories'
import { waitFor } from '@testing-library/react'

describe('Button', () => {
  it('renders a button or a link, with variant, size, icon and active classes', () => {
    render(
      <>
        <Button>Plain</Button>
        <Button href="/x" variant="outline" size="sm" active>
          Link
        </Button>
        <Button icon size="lg" variant="ghost" className="extra">
          ×
        </Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Plain' })).toHaveClass('bg-primary')
    const link = screen.getByRole('link', { name: 'Link' })
    expect(link).toHaveAttribute('href', '/x')
    expect(link).toHaveClass('border-text-light', 'bg-secondary', 'px-3')
    expect(screen.getByRole('button', { name: '×' })).toHaveClass('size-11', 'extra')
  })
})

describe('Badge', () => {
  it('composes classes per variant', () => {
    render(
      <Badge variant="success" role="status" aria-label="ok" className="m-1">
        Done
      </Badge>,
    )
    expect(screen.getByRole('status')).toHaveClass('status-badge', 'bg-emerald-100', 'm-1')
    expect(screen.getByRole('status')).toHaveAttribute('data-emphasis', 'filled')
    expect(badgeClasses('neutral')).toContain('bg-gray-100')
    expect(badgeColorClasses('danger')).toContain('bg-red-100')
  })

  it('outlines a badge the viewer is waiting on, at the same size', () => {
    render(
      <>
        <Badge variant="info" outline>
          In review
        </Badge>
        <Badge variant="info">Mine</Badge>
      </>,
    )
    const outline = screen.getByText('In review')
    expect(outline).toHaveAttribute('data-emphasis', 'outline')
    expect(outline).toHaveClass('bg-transparent', 'border-2', 'border-blue-400')
    expect(screen.getByText('Mine')).toHaveClass('border-2', 'border-blue-100')
  })

  it('shows a flag as muted text with a dot', () => {
    render(<StatusFlag>Seeking help</StatusFlag>)
    expect(screen.getByText('• Seeking help')).toHaveClass('text-text-light')
  })
})

describe('form controls', () => {
  it('wrap native inputs and optional labels', async () => {
    const onChange = vi.fn()
    render(
      <>
        <Toggle onChange={onChange}>Toggle me</Toggle>
        <Radio name="r" value="a">
          Option
        </Radio>
        <Checkbox defaultChecked>Tick</Checkbox>
        <Toggle>{null}</Toggle>
      </>,
    )
    await userEvent.click(screen.getByLabelText('Toggle me'))
    expect(onChange).toHaveBeenCalled()
    expect(screen.getByLabelText('Option')).toHaveAttribute('type', 'radio')
    expect(screen.getByLabelText('Tick')).toBeChecked()
  })
})

describe('Alert', () => {
  it('auto-dismisses success alerts and offers a dismiss button', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const onDismiss = vi.fn()
    const { rerender } = render(<Alert message="Saved" type="success" onDismiss={onDismiss} />)
    expect(screen.getByRole('alert')).toHaveClass('toast-success')
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(5000))
    expect(onDismiss).toHaveBeenCalledTimes(2)
    rerender(<Alert message="Oops" type="error" onDismiss={onDismiss} />)
    expect(screen.getByRole('alert')).toHaveClass('toast-error')
    rerender(<Alert message="FYI" type="info" />)
    expect(screen.getByRole('alert')).toHaveClass('toast-info')
    expect(screen.queryByLabelText('Dismiss')).toBeNull()
    vi.useRealTimers()
  })
})

describe('ConfirmDialog', () => {
  it('renders nothing when closed, and confirms, cancels or closes when open', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const props = { title: 'Delete it?', body: 'Gone for good.', confirmLabel: 'Delete', onConfirm }
    const { rerender } = render(
      <ConfirmDialog {...props} isOpen={false} onClose={onClose} danger busy />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(
      <ConfirmDialog {...props} isOpen onClose={onClose} danger busy busyLabel="Deleting…" />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete it?' })
    expect(dialog).toHaveTextContent('Gone for good.')
    const confirm = screen.getByRole('button', { name: 'Deleting…' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveClass('bg-error')
    await userEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()

    rerender(<ConfirmDialog {...props} isOpen onClose={onClose} busy cancelLabel="Keep it" />)
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-primary')
    rerender(<ConfirmDialog {...props} isOpen onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('DescriptionTips / Tooltip', () => {
  it('renders the tips and a hover tooltip in a portal', async () => {
    render(
      <>
        <DescriptionTips />
        <Tooltip content="More info">
          <span>hover me</span>
        </Tooltip>
      </>,
    )
    expect(screen.getByText('Goal & impact')).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).toBeNull()
    await userEvent.hover(screen.getByText('hover me'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('More info')
    await userEvent.unhover(screen.getByText('hover me'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows on keyboard focus, hides on Escape or blur, and shows nothing without content', () => {
    render(
      <div data-chart>
        <Tooltip content="Beside" side="right" within="[data-chart]">
          <button type="button">Bar</button>
        </Tooltip>
        <Tooltip content={null} within="[data-missing]">
          <button type="button">Bare</button>
        </Tooltip>
      </div>,
    )
    const bar = screen.getByRole('button', { name: 'Bar' })
    act(() => bar.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('Beside')
    fireEvent.keyDown(bar, { key: 'Enter' })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.keyDown(bar, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => bar.blur())
    act(() => screen.getByRole('button', { name: 'Bare' }).focus())
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('places the tip beside or above its trigger, and keeps it inside its bounds', () => {
    const bounds = { left: 0, top: 0, right: 500, bottom: 300 }
    const size = { width: 100, height: 40 }
    const at = (left: number, right: number, top = 100) => ({
      rect: { left, right, top, bottom: top + 20 },
      bounds,
    })
    // Room on the right: just past the trigger, centred on it.
    expect(placeTip('right', at(50, 150), size)).toEqual({ left: 156, top: 90 })
    // None on the right: to its left instead.
    expect(placeTip('right', at(380, 450), size)).toEqual({ left: 274, top: 90 })
    // Above and centred, pushed down and in when it would leave the top or the side.
    expect(placeTip('top', at(200, 300), size)).toEqual({ left: 200, top: 54 })
    expect(placeTip('top', at(0, 20, 10), size)).toEqual({ left: 6, top: 6 })
  })
})

describe('Tabs', () => {
  it('marks the active tab and reports clicks', async () => {
    const onChange = vi.fn()
    render(
      <Tabs
        role="tablist"
        activeTab="a"
        onChange={onChange}
        tabs={[
          { key: 'a', label: 'A', 'data-tab': 'a' },
          { key: 'b', label: 'B' },
        ]}
      />,
    )
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'B' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('Providers / LandingCTA', () => {
  it('shows join/login when signed out and browse/dashboard when signed in', async () => {
    render(
      <Providers>
        <span>child</span>
      </Providers>,
    )
    expect(screen.getByText('child')).toBeInTheDocument()
    await renderApp(<LandingCTA />)
    expect(screen.getByRole('link', { name: 'Apply to join' })).toHaveAttribute('href', '/signup')
    const vol = await createVolunteer()
    await renderApp(<LandingCTA size="md" />, { as: vol })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Browse projects' })).toBeInTheDocument(),
    )
  })
})

describe('Skeleton', () => {
  it('holds the layout with placeholder shapes and a label for screen readers', () => {
    const { container, rerender } = render(<Skeleton label="Loading things…" />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent('Loading things…')
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3)
    rerender(<Skeleton label="Loading rows…" variant="row" count={2} className="loading" />)
    expect(screen.getByRole('status')).toHaveClass('loading')
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2)
  })
})

describe('EmptyState', () => {
  it('names the empty list and offers the next step', () => {
    render(<EmptyState title="Nothing here" body="Try elsewhere." action={<a href="/x">Go</a>} />)
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument()
    expect(screen.getByText('Try elsewhere.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/x')
  })
})
