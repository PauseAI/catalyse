import { describe, it, expect } from 'vitest'
import {
  decodeMentions,
  encodeMentions,
  mentionToken,
  mentionedIds,
  mentionsToPlain,
  splitMentions,
} from './mentions'

const ann = { id: 1, name: 'Ann' }
const anna = { id: 2, name: 'Anna Lee' }

describe('mentions', () => {
  it('builds tokens that survive awkward names', () => {
    expect(mentionToken(ann)).toBe('@[Ann](1)')
    expect(mentionToken({ id: 3, name: 'Jo [admin] (UK)' })).toBe('@[Jo admin UK](3)')
  })

  it('reads ids once each, and renders plain text and parts', () => {
    const content = 'Hi @[Ann](1) and @[Anna Lee](2), @[Ann](1) again'
    expect(mentionedIds(content)).toEqual([1, 2])
    expect(mentionsToPlain(content)).toBe('Hi @Ann and @Anna Lee, @Ann again')
    expect(splitMentions(content)).toEqual(['Hi ', ann, ' and ', anna, ', ', ann, ' again'])
    expect(splitMentions('@[Ann](1)')).toEqual([ann])
    expect(splitMentions('no mentions')).toEqual(['no mentions'])
    expect(mentionedIds('an @email.com and @[broken](x)')).toEqual([])
  })

  it('encodes picked names, longest first, only at a word end', () => {
    expect(encodeMentions('hi @Ann', [])).toBe('hi @Ann')
    expect(encodeMentions('@Anna Lee and @Ann, not @Annie', [ann, anna])).toBe(
      '@[Anna Lee](2) and @[Ann](1), not @Annie',
    )
    expect(encodeMentions('@Jo admin? yes', [{ id: 3, name: 'Jo (admin)' }])).toBe(
      '@[Jo admin](3)? yes',
    )
  })

  it('decodes a saved comment for editing, and round-trips', () => {
    const saved = 'ping @[Ann](1) and @[Anna Lee](2)'
    const { text, picked } = decodeMentions(saved)
    expect(text).toBe('ping @Ann and @Anna Lee')
    expect(picked).toEqual([ann, anna])
    expect(encodeMentions(text, picked)).toBe(saved)
  })
})
