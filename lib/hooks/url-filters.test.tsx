import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useUrlParam, useUrlSearchInput } from './url-filters'

function ParamProbe() {
  const [status, setStatus] = useUrlParam('status')
  return (
    <>
      <span data-testid="status">{status}</span>
      <button onClick={() => setStatus('ready')}>set</button>
      <button onClick={() => setStatus('')}>clear</button>
    </>
  )
}

function SearchProbe() {
  const [input, setInput, urlValue] = useUrlSearchInput('q', 50)
  return (
    <>
      <input value={input} onChange={(e) => setInput(e.target.value)} />
      <span data-testid="url">{urlValue}</span>
    </>
  )
}

describe('useUrlParam', () => {
  it('reads from and writes to the URL query string', async () => {
    window.history.replaceState(null, '', '/projects?page=2')
    render(<ParamProbe />)
    expect(screen.getByTestId('status')).toHaveTextContent('')
    await userEvent.click(screen.getByText('set'))
    expect(screen.getByTestId('status')).toHaveTextContent('ready')
    expect(window.location.search).toBe('?page=2&status=ready')
    await userEvent.click(screen.getByText('clear'))
    expect(window.location.search).toBe('?page=2')
    // Removing the last param leaves a bare pathname.
    window.history.replaceState(null, '', '/projects?status=x')
    await userEvent.click(screen.getByText('clear'))
    expect(window.location.href).toMatch(/\/projects$/)
    // Clearing a param that isn't there writes nothing.
    const replace = vi.spyOn(window.history, 'replaceState')
    await userEvent.click(screen.getByText('clear'))
    expect(replace).not.toHaveBeenCalled()
    replace.mockRestore()
  })
})

describe('useUrlSearchInput', () => {
  it('writes the URL on every keystroke and debounces the committed value', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      window.history.replaceState(null, '', '/volunteers')
      render(<SearchProbe />)
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ann' } })
      expect(window.location.search).toBe('?q=ann')
      expect(screen.getByTestId('url')).toHaveTextContent('')
      act(() => vi.advanceTimersByTime(60))
      expect(screen.getByTestId('url')).toHaveTextContent('ann')
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
      expect(window.location.search).toBe('')
      act(() => vi.advanceTimersByTime(60))
      expect(screen.getByTestId('url')).toHaveTextContent('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('follows the URL when history moves it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      window.history.replaceState(null, '', '/volunteers?q=ann')
      render(<SearchProbe />)
      expect(screen.getByRole('textbox')).toHaveValue('ann')
      expect(screen.getByTestId('url')).toHaveTextContent('ann')
      act(() => window.history.replaceState(null, '', '/volunteers?q=bob'))
      act(() => vi.advanceTimersByTime(60))
      expect(screen.getByTestId('url')).toHaveTextContent('bob')
    } finally {
      vi.useRealTimers()
    }
  })
})
