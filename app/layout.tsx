import type { Metadata, Viewport } from 'next'
import { Montserrat, Roboto_Slab, Saira_Condensed } from 'next/font/google'
import { AuthProvider } from '@/lib/auth-context'
import { ThemeProvider } from '@/components/ThemeProvider'
import { ToastProvider } from '@/lib/toast'
import { RequiredActionsProvider } from '@/lib/required-actions-context'
import Providers from '@/components/Providers'
import FloatingActions from '@/components/FloatingActions'
import Header from '@/components/Header'
import MaintenanceGate from '@/components/MaintenanceGate'
import Footer from '@/components/Footer'
import Analytics from '@/components/Analytics'
import ServiceWorker from '@/components/ServiceWorker'
import UpdatePrompt from '@/components/UpdatePrompt'
import RequiredActions from '@/components/required-actions/RequiredActions'
import Script from 'next/script'
import { THEME_COLOR } from '@/lib/theme-color'
import './globals.css'

const montserrat = Montserrat({
  weight: '900',
  subsets: ['latin'],
  variable: '--font-montserrat',
})

const robotoSlab = Roboto_Slab({
  weight: ['300', '700'],
  subsets: ['latin'],
  variable: '--font-roboto-slab',
})

const sairaCondensed = Saira_Condensed({
  weight: '700',
  subsets: ['latin'],
  variable: '--font-saira',
})

export const metadata: Metadata = {
  title: {
    template: 'Catalyse | %s',
    default: 'Catalyse | PauseAI Volunteer Platform',
  },
  description: 'PauseAI volunteer platform',
  appleWebApp: { title: 'Catalyse', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${robotoSlab.variable} ${sairaCondensed.variable}`}
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
        >{`try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':t==='light'?'light':window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){}`}</Script>
      </head>
      <body className="min-h-screen flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg"
        >
          Skip to content
        </a>
        <Providers>
          <ThemeProvider>
            <AuthProvider>
              <ToastProvider>
                <RequiredActionsProvider>
                  <MaintenanceGate>
                    <Header />
                    <RequiredActions />
                    <main id="main-content">{children}</main>
                    <Footer />
                    <FloatingActions />
                    <Analytics />
                    <UpdatePrompt />
                  </MaintenanceGate>
                </RequiredActionsProvider>
              </ToastProvider>
            </AuthProvider>
          </ThemeProvider>
        </Providers>
        <ServiceWorker />
      </body>
    </html>
  )
}
