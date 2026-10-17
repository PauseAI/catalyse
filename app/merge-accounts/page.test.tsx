import { describe, it, expect } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createChapter, createChapterDeputy, createVolunteer } from '@/test/factories'
import { renderApp } from '@/test/render'
import { clientAs } from '@/test/rpc'
import { emails, linkParam } from '@/test/fakes/email'
import { maskEmail } from '@/lib/mask-email'
import MergeAccountsPage from './page'

/** A link to merge `merged` into `kept`, asked for while signed in to `kept`. */
async function mergeLink(merged?: { id: number; name: string }) {
  const kept = await createVolunteer()
  const other = merged ?? (await createVolunteer({ name: kept.name, duplicateOfId: kept.id }))
  await prisma.volunteer.update({ where: { id: other.id }, data: { duplicateOfId: kept.id } })
  await clientAs(kept).accountMerges.request({ otherId: other.id })
  const token = linkParam(emails.last, 'token')
  return { kept, other, url: `/merge-accounts?token=${token}` }
}

describe('MergeAccountsPage', () => {
  it('says what will happen, merges with the chosen address, and sends a merged-away session to sign in', async () => {
    const { kept, other, url } = await mergeLink()
    const signedIn = await prisma.volunteer.findUniqueOrThrow({ where: { id: other.id } })
    await renderApp(<MergeAccountsPage />, { url, as: signedIn })
    expect(await screen.findByText(/will become one account/)).toHaveTextContent(
      `${other.name} (${maskEmail(signedIn.email!)}) and ${kept.name} (${maskEmail(kept.email!)}) will become one account`,
    )
    expect(screen.getByRole('radio', { name: maskEmail(kept.email!) })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: maskEmail(signedIn.email!) }))
    await userEvent.click(screen.getByRole('button', { name: 'Merge accounts' }))
    expect(await screen.findByRole('heading', { name: 'Accounts merged' })).toBeInTheDocument()
    expect(screen.getByText(/Sign in to it as/)).toHaveTextContent(maskEmail(signedIn.email!))
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    const [keptNow, tombstone] = await Promise.all(
      [kept.id, other.id].map((id) => prisma.volunteer.findUniqueOrThrow({ where: { id } })),
    )
    expect(tombstone).toMatchObject({ mergedIntoId: kept.id, email: kept.email })
    expect(keptNow.email).toBe(signedIn.email)
  })

  it('offers the dashboard to someone signed in to the kept account', async () => {
    const { kept, url } = await mergeLink()
    await renderApp(<MergeAccountsPage />, { url, as: kept })
    await userEvent.click(await screen.findByRole('button', { name: 'Merge accounts' }))
    expect(await screen.findByRole('link', { name: 'Go to your dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
  })

  it('shows why a merge was refused', async () => {
    const deputy = await createChapterDeputy(await createChapter())
    const { url } = await mergeLink(deputy)
    await renderApp(<MergeAccountsPage />, { url })
    await userEvent.click(await screen.findByRole('button', { name: 'Merge accounts' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('holds a chapter role')
  })

  it('turns away a link that is spent or missing its code', async () => {
    await renderApp(<MergeAccountsPage />, { url: '/merge-accounts?token=nonsense' })
    expect(await screen.findByText(/This link has expired or was already used/)).toBeInTheDocument()
    cleanup()
    await renderApp(<MergeAccountsPage />, { url: '/merge-accounts' })
    expect(await screen.findByText(/The link is missing its code/)).toBeInTheDocument()
  })
})
