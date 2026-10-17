import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { authenticateApiToken } from '@/lib/api-tokens'
import { createAdmin, createChapter, createChapterLead } from '@/test/factories'
import { clientAs } from '@/test/rpc'

const DAY_MS = 24 * 60 * 60 * 1000

describe('admin.apiTokens', () => {
  it('creates a token that authenticates as its owner, shown once and stored hashed', async () => {
    const admin = await createAdmin()
    const { token } = await clientAs(admin).admin.apiTokens.create({
      name: '  Orca agents  ',
      scopes: ['bug_reports:read', 'bug_reports:write', 'bug_reports:read'],
      expiresInDays: 90,
    })
    expect(token).toMatch(/^cat_[\w-]{43}$/)

    const row = await prisma.apiToken.findFirstOrThrow({ where: { volunteerId: admin.id } })
    expect(row).toMatchObject({
      name: 'Orca agents',
      scopes: ['bug_reports:read', 'bug_reports:write'],
    })
    expect(row.tokenHash).not.toContain(token)
    expect(row.expiresAt!.getTime()).toBeCloseTo(Date.now() + 90 * DAY_MS, -4)

    const caller = await authenticateApiToken(`Bearer ${token}`)
    expect(caller).toMatchObject({ tokenId: row.id, scopes: row.scopes })
    expect(caller?.volunteer).toMatchObject({ id: admin.id, isAdmin: true })
  })

  it('lists and revokes only the caller’s own tokens', async () => {
    const admin = await createAdmin()
    const other = await createAdmin()
    const mine = clientAs(admin).admin.apiTokens
    await mine.create({ name: 'Forever', scopes: ['bug_reports:read'], expiresInDays: null })
    const { token } = await clientAs(other).admin.apiTokens.create({
      name: 'Theirs',
      scopes: ['bug_reports:read'],
      expiresInDays: 30,
    })

    const [listed] = await mine.list()
    expect(listed).toEqual({
      id: expect.any(Number),
      name: 'Forever',
      scopes: ['bug_reports:read'],
      createdAt: expect.any(Date),
      lastUsedAt: null,
      expiresAt: null,
    })
    expect(await mine.list()).toHaveLength(1)

    const theirs = await prisma.apiToken.findFirstOrThrow({ where: { volunteerId: other.id } })
    await expect(mine.revoke({ id: theirs.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    expect(await clientAs(other).admin.apiTokens.revoke({ id: theirs.id })).toEqual({
      message: 'Token revoked',
    })
    expect(await authenticateApiToken(`Bearer ${token}`)).toBeNull()
  })

  it('refuses a token without a name or a permission', async () => {
    const tokens = clientAs(await createAdmin()).admin.apiTokens
    const refusal = (message: string) => ({
      code: 'BAD_REQUEST',
      data: { issues: [expect.objectContaining({ message })] },
    })
    await expect(
      tokens.create({ name: '  ', scopes: ['bug_reports:read'], expiresInDays: 30 }),
    ).rejects.toMatchObject(refusal('Name is required'))
    await expect(tokens.create({ name: 'x', scopes: [], expiresInDays: 30 })).rejects.toMatchObject(
      refusal('Choose at least one permission'),
    )
  })

  it('is for global admins only', async () => {
    const lead = await createChapterLead(await createChapter())
    await expect(clientAs(lead).admin.apiTokens.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})
