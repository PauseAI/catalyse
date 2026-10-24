'use client'

import { use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useRequireApproved } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import Button from '@/components/Button'
import { useCountries } from '@/lib/hooks/countries'
import { SECTION_CARD } from '@/lib/ui-classes'
import PageLoading from '@/components/PageLoading'
import { H1 } from '@/components/Heading'
import { P } from '@/components/Text'

export default function LocalGroupAdoptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params)
  const id = parseInt(idStr, 10)
  const { user, loading } = useRequireApproved()
  const { label: countryLabel, loaded: countriesLoaded } = useCountries()
  const router = useRouter()
  const showToast = useToast()

  const { data: group, isLoading } = useQuery({
    ...orpc.localGroups.getById.queryOptions({ input: { id } }),
    enabled: !!user && !isNaN(id),
  })

  const adoptMutation = useMutation({
    ...orpc.volunteers.updateMe.mutationOptions(),
    onSuccess: () => {
      showToast('Local group updated!', 'success')
      router.push('/settings')
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to update local group', 'error')
    },
  })

  if (loading || !user) return <PageLoading />

  if (isLoading || !countriesLoaded) {
    return (
      <main className="container py-5">
        <div className="text-center py-10 text-text-light">Loading…</div>
      </main>
    )
  }

  if (!group) {
    return (
      <main className="container py-5">
        <P className="text-text-light">Local group not found.</P>
      </main>
    )
  }

  return (
    <main className="container py-5 pb-15">
      <div className={`${SECTION_CARD} sm:max-w-125`}>
        <H1 className="mt-0 mb-1">{group.name}</H1>
        <P className="text-text-light mb-5">{countryLabel(group.country)}</P>
        <P className="mb-5">
          Want to set this as your local group? You&apos;ll be listed under {group.name} and matched
          with local projects and volunteers there.
        </P>
        <div className="flex gap-3">
          <Button
            disabled={adoptMutation.isPending}
            onClick={() => adoptMutation.mutate({ localGroup: group.name, country: group.country })}
          >
            {adoptMutation.isPending ? 'Saving…' : 'Set as my local group'}
          </Button>
          <Link className="text-primary-text underline" href="/settings">
            <Button variant="secondary">Not now</Button>
          </Link>
        </div>
      </div>
    </main>
  )
}
