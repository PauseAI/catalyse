'use client'

import { useRequireAdmin } from '@/lib/hooks/auth'
import DuplicatePairs from '@/components/DuplicatePairs'
import { SECTION_CARD } from '@/lib/ui-classes'
import { H1 } from '@/components/Heading'
import { P } from '@/components/Text'

/** Every pair of accounts that looks like one person, for a global admin to settle. */
export default function AdminDuplicatesPage() {
  const { user, loading } = useRequireAdmin()
  if (loading || !user?.isAdmin) return null

  return (
    <main className="container py-5 pb-15">
      <H1>Possible duplicates</H1>
      <P className="text-text-light">
        Accounts with the same name, Discord handle or phone number. Keep the account the person
        uses: the other is marked as its duplicate, which global admins see, and cannot be given a
        chapter role. A pair you mark as different people is not shown again.
      </P>
      <section className={SECTION_CARD}>
        <DuplicatePairs emptyText="No possible duplicates." />
      </section>
    </main>
  )
}
