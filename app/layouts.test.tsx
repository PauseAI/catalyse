import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

type LayoutModule = {
  default: React.ComponentType<{ children: React.ReactNode }>
  metadata?: { title?: unknown }
}

// Every route segment with a static title, as `[path, module]`. Next's own `import.meta.glob`
// typing shadows Vite's generic one, hence the cast.
const staticLayouts = import.meta.glob(
  ['./*/layout.tsx', './*/*/layout.tsx', './*/*/*/layout.tsx'],
  { eager: true },
) as Record<string, LayoutModule>

describe('route layouts', () => {
  it('each declares a title and renders its children unchanged', () => {
    const entries = Object.entries(staticLayouts)
    expect(entries.length).toBeGreaterThan(20)
    for (const [path, mod] of entries) {
      expect(mod.metadata?.title, path).toBeTruthy()
      const { unmount } = render(<mod.default>{<span>child of {path}</span>}</mod.default>)
      expect(screen.getByText(`child of ${path}`)).toBeInTheDocument()
      unmount()
    }
  })

  it('never names a project in server metadata, which every visitor receives', () => {
    expect(staticLayouts['./projects/[id]/layout.tsx'].metadata?.title).toBe('Project')
    expect(staticLayouts['./projects/[id]/edit/layout.tsx'].metadata?.title).toBe('Edit project')
  })
})
