import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/client'
import { useOptionalUser } from '@/lib/auth-context'
import type { PersonInfo } from '@/lib/people'

const MAX_BATCH = 200

type Waiter = { resolve: (info: PersonInfo) => void; reject: (error: unknown) => void }
let queued: Map<number, Waiter[]> | null = null

/** Every name a page renders in one go is looked up in one request. */
function lookup(id: number): Promise<PersonInfo> {
  return new Promise((resolve, reject) => {
    if (!queued) {
      queued = new Map()
      queueMicrotask(flush)
    }
    queued.set(id, [...(queued.get(id) ?? []), { resolve, reject }])
  })
}

async function flush() {
  const batch = queued as Map<number, Waiter[]>
  queued = null
  const ids = [...batch.keys()]
  for (let i = 0; i < ids.length; i += MAX_BATCH) {
    const chunk = ids.slice(i, i + MAX_BATCH)
    try {
      const people = await client.volunteers.lookup({ ids: chunk })
      for (const person of people) for (const w of batch.get(person.id) ?? []) w.resolve(person)
    } catch (error) {
      for (const id of chunk) for (const w of batch.get(id) ?? []) w.reject(error)
    }
  }
}

/** Whether the viewer can open this person's profile, and the role they are badged with. */
export function usePerson(id: number | null | undefined): PersonInfo | undefined {
  const viewer = useOptionalUser()
  const { data } = useQuery({
    queryKey: ['person', viewer?.id, id],
    queryFn: () => lookup(id as number),
    enabled: Boolean(viewer) && typeof id === 'number',
    retry: false,
  })
  return data
}
