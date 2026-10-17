import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider, useToast } from './toast'

describe('ToastProvider', () => {
  function Probe() {
    const toast = useToast()
    return (
      <>
        <button onClick={() => toast('Saved', 'success')}>success</button>
        <button onClick={() => toast('Plain')}>info</button>
      </>
    )
  }
  it('shows, animates in, and auto-dismisses toasts; the default context is inert', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      render(
        <ToastProvider>
          <Probe />
        </ToastProvider>,
      )
      fireEvent.click(screen.getByText('success'))
      fireEvent.click(screen.getByText('info'))
      expect(screen.getAllByRole('alert')).toHaveLength(2)
      expect(screen.getByText('Saved').closest('[role=alert]')).toHaveClass('opacity-0')
      act(() => vi.advanceTimersByTime(20))
      expect(screen.getByText('Saved').closest('[role=alert]')).toHaveClass('opacity-100')
      fireEvent.click(screen.getAllByLabelText('Dismiss')[1])
      act(() => vi.advanceTimersByTime(4300))
      expect(screen.queryAllByRole('alert')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
    render(<Probe />)
    await userEvent.click(screen.getAllByText('info')[1])
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })
})
