import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { createAdmin } from '@/test/factories'
import { renderApp } from '@/test/render'
import StorybookAdminPage from './page'

describe('admin storybook page', () => {
  it('links to the gated view, carrying the viewer’s own session token', async () => {
    const admin = await createAdmin()
    await renderApp(<StorybookAdminPage />, { as: admin })

    const link = await screen.findByRole('link', { name: /Open Storybook/ })
    const token = localStorage.getItem('authToken')
    expect(link).toHaveAttribute('href', `/admin/storybook/view/?token=${token}`)
    expect(link).toHaveAttribute('target', '_blank')
  })
})
