import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { prisma } from '@/lib/prisma'
import { createApiToken } from '@/lib/api-tokens'
import type { ApiTokenScope } from '@/lib/api-token-scopes'
import { createSession } from '@/lib/auth'
import { createAdmin, createVolunteer } from '@/test/factories'
import { POST } from '@/app/api/mcp/route'

const MCP_URL = 'http://localhost/api/mcp'
const ALL_SCOPES: ApiTokenScope[] = ['bug_reports:read', 'bug_reports:write']

// Next answers 405 for a method the route does not export, which tells the client there is
// no event stream to open.
const routeFetch = (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init)
  return request.method === 'POST'
    ? POST(request)
    : Promise.resolve(new Response(null, { status: 405 }))
}

const clients: Client[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()))
})

async function connect(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: routeFetch,
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  clients.push(client)
  return client
}

async function tokenFor(owner: { id: number }, scopes = ALL_SCOPES, expiresAt: Date | null = null) {
  return (await createApiToken(owner.id, { name: 'Agent', scopes, expiresAt })).token
}

const post = (authorization?: string) =>
  POST(
    new Request(MCP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  )

/** The JSON a tool returned, after the note marking it as user-written. */
function payload(result: Awaited<ReturnType<Client['callTool']>>) {
  const [first] = result.content as { type: 'text'; text: string }[]
  expect(first.text).toMatch(/^Titles, descriptions and comments below were written by/)
  return JSON.parse(first.text.slice(first.text.indexOf('\n\n') + 2))
}

const message = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { text: string }[])[0].text

async function createReport(
  overrides: Partial<Parameters<typeof prisma.bugReport.create>[0]['data']> = {},
) {
  return prisma.bugReport.create({
    data: { title: 'Save button broken', description: 'Clicking save does nothing', ...overrides },
  })
}

describe('MCP endpoint', () => {
  it('turns away a request without a live API token', async () => {
    const admin = await createAdmin()
    const missing = await post()
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe('Bearer')

    expect((await post(`Bearer ${await createSession(admin.id)}`)).status).toBe(401)
    expect((await post('Bearer cat_unknown')).status).toBe(401)

    const expired = await tokenFor(admin, ALL_SCOPES, new Date(Date.now() - 1000))
    expect((await post(`Bearer ${expired}`)).status).toBe(401)

    const gone = await createAdmin()
    const goneToken = await tokenFor(gone)
    await prisma.volunteer.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
    expect((await post(`Bearer ${goneToken}`)).status).toBe(401)
  })

  it('accepts only a global admin’s token', async () => {
    const volunteer = await createVolunteer()
    const refused = await post(`Bearer ${await tokenFor(volunteer)}`)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'Only global admins can use the MCP server' })

    // A flag the ADMIN_EMAILS list no longer backs grants nothing.
    const former = await createVolunteer({ isAdmin: true })
    expect((await post(`Bearer ${await tokenFor(former)}`)).status).toBe(403)
  })

  it('offers only the tools the token’s scopes grant, and records its use', async () => {
    const admin = await createAdmin()
    const { id, token } = await createApiToken(admin.id, {
      name: 'Reader',
      scopes: ['bug_reports:read'],
      expiresAt: null,
    })
    const reader = await connect(token)
    expect((await reader.listTools()).tools.map((t) => t.name)).toEqual([
      'list_bug_reports',
      'get_bug_report',
    ])
    await expect(prisma.apiToken.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({
      lastUsedAt: expect.any(Date),
    })

    const writer = await connect(await tokenFor(admin, ['bug_reports:write']))
    expect((await writer.listTools()).tools.map((t) => t.name)).toEqual([
      'comment_on_bug_report',
      'update_bug_report',
    ])
  })

  it('lists and reads bug reports, marking their text as user-written', async () => {
    const admin = await createAdmin()
    const reporter = await createVolunteer({ name: 'Rita Reporter' })
    const open = await createReport({ reporterId: reporter.id, severity: 'high' })
    const resolved = await createReport({ title: 'Typo on home', status: 'resolved' })
    const commenter = await createVolunteer({ name: 'Cal Commenter' })
    await prisma.bugReportComment.create({
      data: { bugReportId: open.id, authorId: commenter.id, content: 'Still happening' },
    })
    await prisma.bugReportComment.create({
      data: {
        bugReportId: open.id,
        authorId: commenter.id,
        content: 'Never shown',
        deletedAt: new Date(),
      },
    })
    const client = await connect(await tokenFor(admin))

    const all = payload(await client.callTool({ name: 'list_bug_reports', arguments: {} }))
    expect(all.map((r: { id: number }) => r.id)).toEqual(
      expect.arrayContaining([open.id, resolved.id]),
    )
    const onlyOpen = payload(
      await client.callTool({ name: 'list_bug_reports', arguments: { status: 'open' } }),
    )
    expect(onlyOpen.find((r: { id: number }) => r.id === open.id)).toEqual({
      id: open.id,
      title: 'Save button broken',
      status: 'open',
      category: 'bug',
      severity: 'high',
      reporterName: 'Rita Reporter',
      assigneeName: null,
      createdAt: open.createdAt?.toISOString(),
    })
    expect(onlyOpen.some((r: { id: number }) => r.id === resolved.id)).toBe(false)

    const full = payload(
      await client.callTool({ name: 'get_bug_report', arguments: { id: open.id } }),
    )
    expect(full).toMatchObject({
      id: open.id,
      description: 'Clicking save does nothing',
      reporterName: 'Rita Reporter',
      comments: [{ authorName: 'Cal Commenter', content: 'Still happening' }],
    })
  })

  it('reports a refusal from the app as a tool error', async () => {
    const admin = await createAdmin()
    const client = await connect(await tokenFor(admin))
    const result = await client.callTool({ name: 'get_bug_report', arguments: { id: 999999 } })
    expect(result.isError).toBe(true)
    expect(message(result)).toBe('Bug report not found')
  })

  it('comments and resolves as the token’s owner, notifying the reporter', async () => {
    const admin = await createAdmin({ name: 'Ada Admin' })
    const reporter = await createVolunteer()
    const report = await createReport({ reporterId: reporter.id })
    const client = await connect(await tokenFor(admin))

    const commented = await client.callTool({
      name: 'comment_on_bug_report',
      arguments: { id: report.id, content: 'Fixed in the next release' },
    })
    expect(message(commented)).toBe('Comment added')
    expect(
      await prisma.bugReportComment.findFirstOrThrow({ where: { bugReportId: report.id } }),
    ).toMatchObject({ authorId: admin.id, content: 'Fixed in the next release' })
    expect(
      await prisma.notification.findFirstOrThrow({
        where: { volunteerId: reporter.id, type: 'bug_report_comment_reply' },
      }),
    ).toMatchObject({ link: `/bugs/${report.id}` })

    const updated = await client.callTool({
      name: 'update_bug_report',
      arguments: { id: report.id, status: 'resolved', resolutionNotes: 'Shipped in #400' },
    })
    expect(message(updated)).toBe('Bug report updated')
    expect(await prisma.bugReport.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({
      status: 'resolved',
      resolutionNotes: 'Shipped in #400',
      resolvedById: admin.id,
      resolvedAt: expect.any(Date),
    })
  })
})
