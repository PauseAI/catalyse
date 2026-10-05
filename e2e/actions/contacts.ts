import { expect } from '@playwright/test'
import { createApiClient } from '../client'

/**
 * Connects two volunteers through the API: `from` sends a contact request and `to` accepts
 * it, so each may then message the other and see their contact details.
 */
export async function connectVolunteers(
  baseUrl: string,
  fromToken: string,
  toToken: string,
): Promise<void> {
  const toApi = createApiClient(baseUrl, toToken)
  const me = await toApi.auth.me()
  const toId = (me.body as { id: number }).id
  const sent = await createApiClient(baseUrl, fromToken).contacts.request({
    body: { toVolunteerId: toId, message: 'e2e: we would like to talk about a project together.' },
  })
  expect(sent.status).toBe(200)
  const list = await toApi.notifications.list({ body: {} })
  const action = (
    list.body as { notifications: { action: { kind: string; requestId?: number } | null }[] }
  ).notifications.find((n) => n.action?.kind === 'contact_request')?.action
  const answered = await toApi.contacts.respond({
    body: { id: action!.requestId!, accept: true },
  })
  expect(answered.status).toBe(200)
}
