'use client'

import { useRequireAdmin } from '@/lib/hooks/auth'
import DuplicatePairs from '@/components/DuplicatePairs'
import { SECTION_CARD } from '@/lib/ui-classes'

/** Every pair of accounts that looks like one person, for a global admin to settle. */
export default function AdminDuplicatesPage() {
  const { user, loading } = useRequireAdmin()
  if (loading || !user?.isAdmin) return null

  return (
    <main className="container py-5 pb-15">
      <h1>Possible duplicates</h1>
      <p className="text-text-light">
        Accounts with the same name, Discord handle or phone number. Keep the account the person
        uses: the other is left out of the directory and of volunteer pickers. A pair you mark as
        different people is not shown again.
      </p>
      <section className={SECTION_CARD}>
        <DuplicatePairs emptyText="No possible duplicates." />
      </section>
    </main>
  )
}
