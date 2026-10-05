import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Button from './Button'
import { Badge, badgeClasses, badgeColorClasses } from './Badge'
import Toggle from './Toggle'
import Radio from './Radio'
import Checkbox from './Checkbox'
import Alert from './ui/Alert'
import ConfirmDialog from './ui/ConfirmDialog'
import DescriptionTips from './DescriptionTips'
import Tooltip from './Tooltip'
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
    expect(badgeClasses('neutral')).toContain('bg-gray-100')
    expect(badgeColorClasses('danger')).toBe(
      'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    )
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
    expect(screen.getByText('Goal & Impact')).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).toBeNull()
    await userEvent.hover(screen.getByText('hover me'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('More info')
    await userEvent.unhover(screen.getByText('hover me'))
    expect(screen.queryByRole('tooltip')).toBeNull()
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
