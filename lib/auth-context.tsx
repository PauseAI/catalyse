'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { client } from '@/lib/client'

interface User {
  id: number
  email: string
  name: string
  isAdmin: boolean
  isSuperAdmin: boolean
  /** An admin browsing as a volunteer: `isAdmin` and `isSuperAdmin` read false meanwhile. */
  viewingAsVolunteer: boolean
  approvalStatus: string
  emailConfirmed: boolean
  hasPassword: boolean
  emailDigest: string | null
  cookieConsentAnalytics: boolean | null
  location: string | null
  country: string | null
  localGroup: string | null
  locationConfirmedAt: Date | null
  skills: Array<{
    id: number
    name: string
    categoryId: number
    categoryName: string
    proficiencyLevel: string | null
    description: string | null
    sortOrder: number | null
    createdAt: Date | null
  }>
}

interface AuthContextValue {
  user: User | null
  token: string | null
  loading: boolean
  setToken: (token: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // The stored token is only read after mount, so the first client render matches the
  // server's: nobody signed in, still loading. Reading localStorage during render would
  // make the two disagree whenever a token exists.
  const [token, setTokenState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const fetchMe = useCallback(async (): Promise<User | null> => {
    try {
      const data = await client.auth.me()
      const u = data as User
      setUser(u)
      return u
    } catch {
      localStorage.removeItem('authToken')
      setTokenState(null)
      setUser(null)
      return null
    }
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem('authToken')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTokenState(stored)
    if (!stored) {
      setLoading(false)
      return
    }
    fetchMe().finally(() => setLoading(false))
  }, [fetchMe])

  useEffect(() => {
    const handler = () => {
      localStorage.removeItem('authToken')
      setTokenState(null)
      setUser(null)
    }
    window.addEventListener('auth:expired', handler)
    return () => window.removeEventListener('auth:expired', handler)
  }, [])

  const setToken = useCallback(
    async (t: string) => {
      localStorage.setItem('authToken', t)
      setTokenState(t)
      const vol = await fetchMe()
      if (vol && vol.cookieConsentAnalytics === null) {
        const stored = localStorage.getItem('cookieConsent')
        if (stored !== null) {
          await client.volunteers
            .updateMe({ cookieConsentAnalytics: stored === 'true' })
            .catch(() => {})
        }
      }
    },
    [fetchMe],
  )

  const logout = useCallback(async () => {
    await client.auth.logout().catch(() => {})
    localStorage.removeItem('authToken')
    setTokenState(null)
    setUser(null)
    router.push('/login')
  }, [router])

  const refreshUser = useCallback(async () => {
    const t = localStorage.getItem('authToken')
    if (t) await fetchMe()
  }, [fetchMe])

  return (
    <AuthContext.Provider value={{ user, token, loading, setToken, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
