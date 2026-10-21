import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

// WCAG 2.1 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const css = readFileSync(path.join(__dirname, 'globals.css'), 'utf8')
const LIGHT = '@theme static {'
const DARK = "[data-theme='dark'] {"
function block(selector: string, source = css): string {
  return source.slice(source.indexOf(selector)).split('}')[0]
}
function tokens(selector: string, source = css): Record<string, string> {
  return Object.fromEntries(
    [...block(selector, source).matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [
      m[1],
      m[2],
    ]),
  )
}

describe('the offline page', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'offline.html'), 'utf8')
  it.each([
    [LIGHT, ':root {'],
    [DARK, DARK],
  ])('copies the %s tokens it uses', (appSelector, pageSelector) => {
    const page = tokens(pageSelector, html)
    const app = tokens(appSelector)
    expect(Object.keys(page)).toContain('brand-bg')
    for (const [name, value] of Object.entries(page))
      expect([name, value]).toEqual([name, app[name]])
  })
})

// Every colour used for text, against every background it is drawn on.
const TEXT = [
  'brand-text',
  'heading',
  'text-light',
  'primary-text',
  'error',
  'success',
  'warning-text',
]
const BACKGROUNDS = ['brand-bg', 'surface']

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s theme text contrast', (_theme, selector) => {
  const t = tokens(selector)
  it.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg])))(
    '--color-%s on --color-%s meets WCAG AA (4.5:1)',
    (fg, bg) => {
      expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5)
    },
  )
})

// `--color-secondary-dark` is a fill (button hover); as a text colour it is grey on the dark page.
// Headings use `--color-heading`, and text on the orange fill uses `text-gray-900`.
const ON_PRIMARY = '#111827'

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s theme text on the orange fill', (_theme, selector) => {
  it('gray-900 on --color-primary meets WCAG AA (4.5:1)', () => {
    expect(contrast(ON_PRIMARY, tokens(selector).primary)).toBeGreaterThanOrEqual(4.5)
  })
})

const root = path.join(__dirname, '..')
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [full] : []
  })
}
function linesMatching(test: (line: string) => boolean): string[] {
  return ['app', 'components']
    .flatMap((d) => sourceFiles(path.join(root, d)))
    .flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter(test)
        .map((line) => `${path.relative(root, file)}: ${line.trim()}`),
    )
}

describe('outline buttons', () => {
  it('are drawn in the text colours, which are measured above, not in --color-secondary', () => {
    const button = readFileSync(path.join(root, 'components', 'Button.tsx'), 'utf8')
    const outline = button.match(/outline:\s*'([^']*)'/)?.[1] ?? ''
    expect(outline).toContain('text-brand-text')
    expect(outline).toContain('border-text-light')
    expect(outline).not.toMatch(/\btext-secondary\b|\bborder-secondary\b/)
  })
})

describe('text-secondary and text-secondary-dark', () => {
  it('are not text colours: both are fills, grey on the dark page', () => {
    expect(linesMatching((line) => /\btext-secondary(-dark)?(?![-\w])/.test(line))).toEqual([])
  })
})

describe('dark: utilities', () => {
  it('never recolour a token, which the dark block already redefines', () => {
    const names = [...block(LIGHT).matchAll(/--color-([\w-]+):/g)].map((m) => m[1])
    const onToken = new RegExp(`\\bdark:(?:[\\w-]+:)*[a-z]+-(?:${names.join('|')})(?![-\\w])`)
    expect(names).toContain('surface')
    expect(linesMatching((line) => onToken.test(line))).toEqual([])
  })
})
