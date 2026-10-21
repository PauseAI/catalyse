import type { MetadataRoute } from 'next'
import { THEME_COLOR } from '@/lib/theme-color'

/** A manifest takes one theme colour; the layout's viewport gives dark mode its own. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Catalyse | PauseAI Volunteer Platform',
    short_name: 'Catalyse',
    description: 'PauseAI volunteer platform',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: THEME_COLOR.light,
    theme_color: THEME_COLOR.light,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
