import { describe, it, expect } from 'vitest'
import { screen, waitFor, cleanup, act } from '@testing-library/react'
import { createVolunteer, createAdmin, createChapter, createChapterDeputy } from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import {
  useRequireAuth,
  useRequireApproved,
  useRequireConfirmed,
  useRequireAdmin,
  useRequireStaff,
} from './auth'

const hooks = {
  useRequireAuth,
  useRequireApproved,
  useRequireConfirmed,
  useRequireAdmin,
  useRequireStaff,
}
type HookName = keyof typeof hooks

function Probe({ hook }: { hook: HookName }) {
  const { user, loading } = hooks[hook]()
  return <span>{loading ? 'loading' : user ? `user:${user.name}` : 'anon'}</span>
}

async function settle(hook: HookName, as: NonNullable<Parameters<typeof renderApp>[1]>['as']) {
  cleanup()
  await renderApp(<Probe hook={hook} />, { as })
  await waitFor(() => expect(screen.getByText(/user:|anon/)).toBeInTheDocument())
  // The redirect runs in a passive effect, which can still be pending when the text lands.
  await act(async () => {})
}

describe('auth gate hooks', () => {
  it('all redirect anonymous visitors to /login', async () => {
    for (const hook of Object.keys(hooks) as HookName[]) {
      navigation.reset()
      await settle(hook, null)
      expect(navigation.replace).toHaveBeenCalledWith('/login')
    }
  })

  it('useRequireAuth lets any signed-in user through', async () => {
    await settle('useRequireAuth', await createVolunteer({ approvalStatus: 'pending' }))
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it('useRequireApproved sends unapproved non-admins to the dashboard, with a notice', async () => {
    const pending = await createVolunteer({ approvalStatus: 'pending' })
    await settle('useRequireApproved', pending)
    expect(navigation.replace).toHaveBeenCalledWith('/dashboard')
    // The page never gets the user, so it cannot render anything for them meanwhile.
    expect(screen.getByText('anon')).toBeInTheDocument()
    navigation.reset()
    await settle('useRequireApproved', await createAdmin({ approvalStatus: 'pending' }))
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it('useRequireConfirmed sends an unconfirmed email to /verify-email', async () => {
    const unconfirmed = await createVolunteer({ emailConfirmed: false })
    await settle('useRequireConfirmed', unconfirmed)
    expect(navigation.replace).toHaveBeenCalledWith('/verify-email')
    expect(screen.getByText('anon')).toBeInTheDocument()
    navigation.reset()
    await settle('useRequireConfirmed', await createVolunteer())
    expect(navigation.replace).not.toHaveBeenCalled()
    navigation.reset()
    await settle(
      'useRequireConfirmed',
      await createVolunteer({ approvalStatus: 'pending', emailConfirmed: false }),
    )
    expect(navigation.replace).toHaveBeenCalledWith('/dashboard')
  })

  it('useRequireStaff and useRequireAdmin send the wrong role to /projects', async () => {
    const deputy = await createChapterDeputy(await createChapter())
    await settle('useRequireStaff', await createVolunteer())
    expect(navigation.replace).toHaveBeenCalledWith('/projects?notice=no-access')
    for (const allowed of [deputy, await createAdmin()]) {
      navigation.reset()
      await settle('useRequireStaff', allowed)
      expect(navigation.replace).not.toHaveBeenCalled()
    }
    navigation.reset()
    await settle('useRequireAdmin', deputy)
    expect(navigation.replace).toHaveBeenCalledWith('/projects?notice=global-admin-only')
    navigation.reset()
    await settle('useRequireAdmin', await createAdmin())
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})
