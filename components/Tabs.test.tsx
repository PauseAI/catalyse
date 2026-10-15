import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Tabs from './Tabs'

const tabs = [
  { key: 'a', label: 'Overview' },
  { key: 'b', label: 'People' },
]

// jsdom has no layout, so the strip's widths are set by hand.
function setWidths(el: HTMLElement, widths: { scroll: number; client: number; left: number }) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: widths.scroll })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: widths.client })
  el.scrollLeft = widths.left
}

describe('Tabs', () => {
  it('fades the right edge only while tabs lie beyond it', () => {
    render(<Tabs tabs={tabs} activeTab="a" onChange={() => {}} role="tablist" />)
    const strip = screen.getByRole('tablist')
    expect(strip.className).not.toMatch(/mask-image/)

    setWidths(strip, { scroll: 500, client: 300, left: 0 })
    fireEvent.scroll(strip)
    expect(strip.className).toMatch(/mask-image/)

    setWidths(strip, { scroll: 500, client: 300, left: 200 })
    fireEvent.scroll(strip)
    expect(strip.className).not.toMatch(/mask-image/)
  })
})
