import { describe, expect, it } from 'vitest'
import { keyDateSides } from './key-date'

const t = (id: number, isAnchor = false) => ({ id, isAnchor })
const link = (predecessorId: number, successorId: number) => ({ predecessorId, successorId })

describe('keyDateSides', () => {
  it('has no sides without a key date', () => {
    expect(keyDateSides([t(1), t(2)], [link(1, 2)]).size).toBe(0)
  })

  it('puts prep before the key date and follow-up after, however far along the chain', () => {
    // Book venue → Print flyers → Protest (key date) → Press release → Write-up; Other stands alone.
    const sides = keyDateSides(
      [t(1), t(2), t(3, true), t(4), t(5), t(6)],
      [link(1, 2), link(2, 3), link(3, 4), link(4, 5)],
    )
    expect(Object.fromEntries(sides)).toEqual({
      1: 'before',
      2: 'before',
      3: 'key',
      4: 'after',
      5: 'after',
      6: 'other',
    })
  })

  it('treats work between two key dates as prep for the later one', () => {
    const sides = keyDateSides([t(1, true), t(2), t(3, true)], [link(1, 2), link(2, 3)])
    expect(sides.get(2)).toBe('before')
  })
})
