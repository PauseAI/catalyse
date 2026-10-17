import type { MetadataRoute } from 'next'
import { env } from '@/lib/env'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/api',
        '/dashboard',
        '/settings',
        '/profile',
        '/bugs',
        '/component-preview',
        '/projects',
        '/quick-tasks',
        '/teams',
        '/suggest',
        '/suggest-team',
        '/suggest-local-group',
        '/verify-email',
        '/reset-password',
        '/accept-invite',
        '/merge-accounts',
      ],
    },
    sitemap: `${env.APP_URL}/sitemap.xml`,
  }
}
