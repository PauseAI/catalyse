import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createProject } from '@/test/factories'

type LayoutModule = {
  default: React.ComponentType<{ children: React.ReactNode }>
  metadata?: { title?: unknown }
}

// Every route segment with a static title, as `[path, module]`. Next's own `import.meta.glob`
// typing shadows Vite's generic one, hence the cast.
const staticLayouts = import.meta.glob(
  [
    './*/layout.tsx',
    './*/*/layout.tsx',
    './*/*/*/layout.tsx',
    '!./projects/[id]/layout.tsx',
    '!./projects/[id]/edit/layout.tsx',
  ],
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

  it('project layouts title themselves after the project', async () => {
    const [
      { generateMetadata: view, default: ViewLayout },
      { generateMetadata: edit, default: EditLayout },
    ] = await Promise.all([import('./projects/[id]/layout'), import('./projects/[id]/edit/layout')])
    const project = await createProject({ title: 'Rally' })
    const params = Promise.resolve({ id: String(project.id) })
    expect(await view({ params })).toEqual({ title: 'Rally' })
    expect(await edit({ params })).toEqual({ title: 'Edit Rally' })
    const missing = Promise.resolve({ id: '999999' })
    expect(await view({ params: missing })).toEqual({ title: 'Project' })
    expect(await edit({ params: missing })).toEqual({ title: 'Edit project' })
    render(
      <ViewLayout>
        <EditLayout>
          <span>nested</span>
        </EditLayout>
      </ViewLayout>,
    )
    expect(screen.getByText('nested')).toBeInTheDocument()
  })
})
