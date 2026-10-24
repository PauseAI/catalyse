import type { NextConfig } from 'next'

// Google Sign-In loads its client script and renders its button in an iframe from
// accounts.google.com; Google Analytics loads gtag.js from googletagmanager.com and
// sends hits to google-analytics.com (regional subdomains included); everything else
// is same-origin. 'unsafe-inline' stays in script-src because Next.js injects inline
// bootstrap/flight scripts without a nonce — the CSP still stops any third-party script host.
// React's development build evals to rebuild server call stacks; production never does.
const devScript = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${devScript} https://accounts.google.com https://www.googletagmanager.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com https://*.google-analytics.com https://*.analytics.google.com",
  "frame-src 'self' https://accounts.google.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  'report-uri /api/csp-report',
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const nextConfig: NextConfig = {
  // Ties each page to the deploy it was built from: Next reloads a page that navigates into a
  // newer deploy, and UpdatePrompt reads it to offer a refresh.
  deploymentId: process.env.RAILWAY_GIT_COMMIT_SHA,
  // Next's dev server refuses its hot-reload connection from other hosts; DEV_ALLOWED_ORIGINS
  // (comma-separated hosts, e.g. a tailnet preview host) lets them in. Dev only.
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(',').filter(Boolean) ?? [],

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Browsers check for a new worker on every load; a cached copy would delay a fix.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      // Storybook's preview pane is its own document (iframe.html) framed by the manager
      // (index.html) of the same route — `frame-ancestors 'none'` above would stop the
      // browser rendering it at all, leaving the preview pane stuck loading forever.
      {
        source: '/admin/storybook/view/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Content-Security-Policy',
            value: CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
          },
        ],
      },
    ]
  },

  async redirects() {
    return [
      // Dynamic routes — id was a query param in the old HTML version
      {
        source: '/static/volunteer.html',
        has: [{ type: 'query', key: 'id', value: '(?<id>.+)' }],
        destination: '/volunteers/:id',
        permanent: false,
      },
      {
        source: '/static/project.html',
        has: [{ type: 'query', key: 'id', value: '(?<id>.+)' }],
        destination: '/projects/:id',
        permanent: false,
      },
      {
        source: '/static/edit-project.html',
        has: [{ type: 'query', key: 'id', value: '(?<id>.+)' }],
        destination: '/projects/:id/edit',
        permanent: false,
      },
      {
        source: '/static/admin/volunteer-detail.html',
        has: [{ type: 'query', key: 'id', value: '(?<id>.+)' }],
        destination: '/admin/volunteers/:id',
        permanent: false,
      },
      // Fallback for dynamic routes without an id
      { source: '/static/volunteer.html', destination: '/volunteers', permanent: false },
      { source: '/static/project.html', destination: '/dashboard', permanent: false },
      { source: '/static/edit-project.html', destination: '/dashboard', permanent: false },
      {
        source: '/static/admin/volunteer-detail.html',
        destination: '/admin/triage',
        permanent: false,
      },
      // Static routes
      { source: '/static/index.html', destination: '/', permanent: false },
      { source: '/static/accept-invite.html', destination: '/accept-invite', permanent: false },
      { source: '/static/admin/bugs.html', destination: '/admin/bugs', permanent: false },
      {
        source: '/static/admin/create-project.html',
        destination: '/admin/projects/new',
        permanent: false,
      },
      { source: '/static/admin/skills.html', destination: '/admin/skills', permanent: false },
      {
        source: '/static/admin/starter-tasks.html',
        destination: '/quick-tasks',
        permanent: false,
      },
      { source: '/admin/starter-tasks', destination: '/quick-tasks', permanent: false },
      { source: '/static/admin/stats.html', destination: '/admin', permanent: false },
      { source: '/static/admin/team.html', destination: '/admin/team', permanent: false },
      { source: '/static/admin/triage.html', destination: '/admin/triage', permanent: false },
      { source: '/static/dashboard.html', destination: '/dashboard', permanent: false },
      { source: '/static/forgot-password.html', destination: '/forgot-password', permanent: false },
      { source: '/static/login.html', destination: '/login', permanent: false },
      { source: '/static/privacy.html', destination: '/privacy', permanent: false },
      { source: '/static/profile.html', destination: '/profile', permanent: false },
      { source: '/static/reset-password.html', destination: '/reset-password', permanent: false },
      { source: '/static/settings.html', destination: '/settings', permanent: false },
      { source: '/static/signup.html', destination: '/signup', permanent: false },
      { source: '/static/starter-tasks.html', destination: '/quick-tasks', permanent: false },
      { source: '/starter-tasks', destination: '/quick-tasks', permanent: false },
      { source: '/starter-tasks/:path*', destination: '/quick-tasks/:path*', permanent: false },
      { source: '/static/suggest.html', destination: '/suggest', permanent: false },
      { source: '/static/volunteers.html', destination: '/volunteers', permanent: false },
    ]
  },
}

export default nextConfig
