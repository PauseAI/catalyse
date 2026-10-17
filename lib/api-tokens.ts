import { randomBytes } from 'crypto'
import type { Volunteer } from '@/generated/prisma/client'
import { extractToken, hashToken, withGlobalAdmin } from './auth'
import type { ApiTokenScope } from './api-token-scopes'
import { prisma } from './prisma'

// The prefix tells an API token from a session token at a glance, and lets a secret scanner
// recognise one that has leaked.
const PREFIX = 'cat_'

export interface ApiCaller {
  tokenId: number
  volunteer: Volunteer
  scopes: ApiTokenScope[]
}

/** Stores a new token for `volunteerId` and returns it: the only time it exists unhashed. */
export async function createApiToken(
  volunteerId: number,
  { name, scopes, expiresAt }: { name: string; scopes: ApiTokenScope[]; expiresAt: Date | null },
): Promise<{ id: number; token: string }> {
  const token = PREFIX + randomBytes(32).toString('base64url')
  const { id } = await prisma.apiToken.create({
    data: { volunteerId, name, scopes, expiresAt, tokenHash: hashToken(token) },
  })
  return { id, token }
}

/** The owner and scopes of the API token in an Authorization header, or null. */
export async function authenticateApiToken(
  authorization: string | null | undefined,
): Promise<ApiCaller | null> {
  const token = extractToken(authorization)
  if (!token?.startsWith(PREFIX)) return null

  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { volunteer: true },
  })
  if (!row || row.volunteer.deletedAt) return null
  if (row.expiresAt && row.expiresAt <= new Date()) return null

  // Fire-and-forget: a failed touch shouldn't fail the request it came with.
  prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})
  return {
    tokenId: row.id,
    volunteer: await withGlobalAdmin(row.volunteer),
    scopes: row.scopes as ApiTokenScope[],
  }
}
