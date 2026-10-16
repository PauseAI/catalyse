import { createApiClient } from '../client'
import { readAdminToken } from '../fixtures'

function adminApi(baseUrl: string) {
  return createApiClient(baseUrl, readAdminToken(baseUrl))
}

/**
 * The id of the chapter for `country`, opened if the worker has none yet. Specs share a worker's
 * database, so each picks a country no other spec uses: opening a chapter pulls in everyone in
 * the holding pool who named that country, and the fixtures sign people up from the UK.
 */
export async function ensureChapter(baseUrl: string, country: string): Promise<number> {
  const api = adminApi(baseUrl)
  const list = await api.admin.chapters.list()
  const found = list.body.chapters.find((c) => c.country === country)
  if (found) return found.id
  const created = await api.admin.chapters.create({ body: { country } })
  if (created.status !== 200) throw new Error(`Chapter failed: ${JSON.stringify(created.body)}`)
  return created.body.id
}

/** Moves a volunteer into a chapter, as a global admin would from the chapter page. */
export async function moveToChapter(
  baseUrl: string,
  volunteerId: number,
  chapterId: number,
): Promise<void> {
  const result = await adminApi(baseUrl).admin.chapters.reassign({
    body: { volunteerId, chapterId },
  })
  if (result.status !== 200) throw new Error(`Move failed: ${JSON.stringify(result.body)}`)
}

/** Puts a member of a chapter on its staff. */
export async function makeChapterStaff(
  baseUrl: string,
  volunteerId: number,
  chapterId: number,
  role: 'LEAD' | 'DEPUTY',
): Promise<void> {
  const api = adminApi(baseUrl)
  const body = { chapterId, volunteerId }
  const result =
    role === 'LEAD'
      ? await api.admin.chapters.appointLead({ body })
      : await api.admin.chapters.appointDeputy({ body })
  if (result.status !== 200) throw new Error(`Appoint failed: ${JSON.stringify(result.body)}`)
}
