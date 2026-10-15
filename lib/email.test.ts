import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as e from './email'
import { env } from './env'
import {
  createEmailTransport,
  emailTransport,
  setEmailTransport,
  FileStubTransport,
  ResendTransport,
  type ResendClient,
  UnconfiguredTransport,
} from './email-transport'
import { emails } from '@/test/fakes/email'
import http from 'node:http'
import { Resend } from 'resend'

const sendMock = vi.fn()
const resendClient = { emails: { send: sendMock } } as unknown as ResendClient

afterEach(() => {
  vi.restoreAllMocks()
  sendMock.mockReset()
})

describe('html tagged template', () => {
  it('escapes interpolations except rawHtml, and stringifies null as empty', () => {
    expect(e.html`<b>${'<i>'}</b>${e.rawHtml('<u>')}${null}${'"&\''}`).toBe(
      '<b>&lt;i&gt;</b><u>&quot;&amp;&#39;',
    )
  })
})

const baseEnv = {
  STUB_EMAIL: false,
  RESEND_API_KEY: undefined,
  FROM_EMAIL: 'from@x',
  REPLY_TO_EMAIL: undefined,
}
const message = { to: 'a@b.c', subject: 'Hello', html: '<p>hi</p>' }

describe('email transports', () => {
  let log: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('is chosen from the environment: stub first, then Resend, else unconfigured', () => {
    expect(createEmailTransport({ ...baseEnv, STUB_EMAIL: true })).toBeInstanceOf(FileStubTransport)
    expect(createEmailTransport({ ...baseEnv, RESEND_API_KEY: 'key' })).toBeInstanceOf(
      ResendTransport,
    )
    expect(createEmailTransport(baseEnv)).toBeInstanceOf(UnconfiguredTransport)
  })

  it('is built once from the environment and can be swapped', () => {
    const fake = emails
    expect(setEmailTransport(undefined)).toBe(fake)
    const fromEnv = emailTransport()
    expect(fromEnv).toBeInstanceOf(FileStubTransport)
    expect(emailTransport()).toBe(fromEnv)
    expect(setEmailTransport(fake)).toBe(fromEnv)
    expect(e.isEmailConfigured()).toBe(true)
  })

  it('writes a preview file when stubbed', async () => {
    const stub = new FileStubTransport()
    expect(stub.configured()).toBe(true)
    expect(await stub.send(message)).toBe(true)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[EMAIL STUB] To: a@b.c'))
  })

  it('logs and returns false when nothing is configured', async () => {
    const none = new UnconfiguredTransport()
    expect(none.configured()).toBe(false)
    expect(await none.send(message)).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[EMAIL NOT CONFIGURED]'))
  })

  it('sends through Resend, with the reply-to from the call or the env', async () => {
    const resend = new ResendTransport(
      { ...baseEnv, RESEND_API_KEY: 'key', REPLY_TO_EMAIL: 'reply@x' },
      resendClient,
    )
    sendMock.mockResolvedValue({ error: null })
    expect(await resend.send(message)).toBe(true)
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: 'from@x',
      to: ['a@b.c'],
      replyTo: 'reply@x',
    })
    await resend.send({ ...message, replyTo: 'b@x' })
    expect(sendMock.mock.calls[1][0]).toMatchObject({ replyTo: 'b@x' })
  })

  it('reports Resend errors and thrown failures as false', async () => {
    const resend = new ResendTransport({ ...baseEnv, RESEND_API_KEY: 'key' }, resendClient)
    sendMock.mockResolvedValueOnce({ error: { message: 'nope' } })
    expect(await resend.send(message)).toBe(false)
    sendMock.mockRejectedValueOnce(new Error('network'))
    expect(await resend.send(message)).toBe(false)
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty('replyTo')
  })

  it('puts the expected request on the wire through the real Resend SDK', async () => {
    // A stand-in for api.resend.com, so the SDK's serialisation and error handling run for
    // real instead of being replaced by the fake client above.
    const requests: { auth: string | undefined; body: Record<string, unknown> }[] = []
    let status = 200
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        requests.push({ auth: req.headers.authorization, body: JSON.parse(body) })
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify(
            status === 200
              ? { id: 'email_1' }
              : { statusCode: status, name: 'validation_error', message: 'bad from' },
          ),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server has no port')
    const client = new Resend('re_key', { baseUrl: `http://127.0.0.1:${address.port}` })
    const resend = new ResendTransport(
      { ...baseEnv, RESEND_API_KEY: 're_key', REPLY_TO_EMAIL: 'reply@x' },
      client,
    )
    try {
      expect(await resend.send(message)).toBe(true)
      expect(requests[0]).toEqual({
        auth: 'Bearer re_key',
        body: {
          from: 'from@x',
          to: ['a@b.c'],
          subject: 'Hello',
          html: '<p>hi</p>',
          reply_to: 'reply@x',
        },
      })
      status = 422
      expect(await resend.send(message)).toBe(false)
      expect(console.error).toHaveBeenCalledWith('[EMAIL ERROR] bad from')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    // With the server gone the SDK reports the failed connection as an error, not a throw.
    expect(await resend.send(message)).toBe(false)
  })

  it('relays a message with a link to reply, and the sender as reply-to only if shared', async () => {
    const relay = { to: 'a@b.c', toName: 'A', fromName: 'B', subject: 'Hi', message: 'm' }
    await e.sendRelayMessage({ ...relay, replyTo: null, threadId: 7 })
    expect(emails.last).toMatchObject({ subject: '[Catalyse] Hi', replyTo: undefined })
    expect(emails.last.html).toContain(`${env.APP_URL}/inbox/messages/7`)
    expect(emails.last.html).not.toContain('reply to this email')
    await e.sendRelayMessage({ ...relay, replyTo: 'b@x', threadId: 7 })
    expect(emails.last).toMatchObject({ replyTo: 'b@x' })
    expect(emails.last.html).toContain('reply to this email')
  })
})

describe('daily summary', () => {
  it('sends one email with each section and its links, escaped', async () => {
    await e.sendDailySummaryEmail({
      to: 'owner@example.com',
      name: '<Olive>',
      subject: 'Catalyse: 2 things need you today',
      sections: [
        { heading: 'Your tasks', lines: [{ text: '“Book <venue>” is due today', href: '/t/1' }] },
        {
          heading: 'Westminster',
          lines: [{ text: 'Jo wants to help', href: '/projects/2#people' }],
          project: true,
        },
        {
          heading: 'Library',
          lines: [{ text: 'Al posted', href: '/projects/3' }],
          project: true,
        },
      ],
    })
    const sent = emails.lastTo('owner@example.com')!
    expect(sent.subject).toBe('Catalyse: 2 things need you today')
    expect(sent.html).toContain('Hi &lt;Olive&gt;')
    expect(sent.html).toContain('<h3 style="margin: 24px 0 8px;">Your tasks</h3>')
    // The projects share one heading, each named under it.
    expect(sent.html.match(/Projects you lead/g)).toHaveLength(1)
    expect(sent.html).toContain('<h4 style="margin: 16px 0 6px;">Westminster</h4>')
    expect(sent.html).toContain('<h4 style="margin: 16px 0 6px;">Library</h4>')
    expect(sent.html).toContain(`href="${env.APP_URL}/t/1"`)
    expect(sent.html).toContain('“Book &lt;venue&gt;” is due today')
  })
})

describe('templates', () => {
  it('builds every template with escaped content and the right links', () => {
    const app = env.APP_URL

    expect(e.buildWelcomeAndConfirmHtml('<A>', `${app}/verify?x`)).toContain('Hi &lt;A&gt;')
    expect(e.buildApplicationReceivedHtml('A')).toContain('Application Received')
    expect(e.buildApplicationApprovedHtml('A', app)).toContain(`${app}/login`)
    expect(e.buildApplicationRejectedHtml('A')).not.toContain('Feedback from the team')
    expect(e.buildApplicationRejectedHtml('A', '<notes>')).toContain('&lt;notes&gt;')
    expect(e.buildApplicationNeedsInfoHtml('A', `${app}/login`)).not.toContain('white-space')
    expect(e.buildApplicationNeedsInfoHtml('A', `${app}/login`, 'n')).toContain('white-space')
    expect(e.buildApplicationReopenedHtml('A', `${app}/login`)).toContain('reopened')
    expect(e.buildApplicationReopenedHtml('A', `${app}/login`, 'n')).toContain('white-space')
    expect(e.buildPendingApplicationsSummaryHtml(3, app)).toContain('3')
    expect(e.buildPasswordResetHtml(`${app}/reset`, 'A')).toContain('Reset Your Password')
    expect(e.buildAdminInviteHtml(`${app}/invite`, 'B')).toContain('B')
    expect(e.buildOutreachLoginHtml(`${app}/outreach`)).toContain(`${app}/outreach`)
    expect(e.buildWelcomeHtml('A', app)).toContain('Welcome')
    expect(e.buildProjectNotificationHtml('A', 'S', 'M', 5, app, '<extra/>')).toContain(
      `${app}/projects/5`,
    )
    expect(e.buildAdminAlertHtml('A', 'S', 'M', 'Go', `${app}/go`)).toContain('Go')
    expect(e.buildLocalGroupSuggestionHtml('A', 'accepted', 'G')).toContain('Great news')
    expect(e.buildLocalGroupSuggestionHtml('A', 'merge', 'G')).toContain('merged')
    expect(e.buildLocalGroupSuggestionHtml('A', 'on_hold', 'G')).toContain('under review')
    expect(e.buildLocalGroupSuggestionHtml('A', 'declined', 'G')).toContain('not to add')
    expect(e.buildLocalGroupSuggestionHtml('A', 'weird', 'G', 'note')).toContain(
      'has been reviewed',
    )
    expect(e.buildLocalGroupSuggestionHtml('A', 'weird', 'G', 'note')).toContain('<em>note</em>')
    expect(e.buildRelayMessageHtml('A', 'B', 'S', 'M', undefined, '/t', false)).not.toContain(
      'about the project',
    )
    expect(e.buildRelayMessageHtml('A', 'B', 'S', 'M', 'P', '/t', false)).toContain(
      'about the project',
    )

    const long = 'x'.repeat(200)
    const digest = e.buildDigestHtml('A', app, [
      { id: 1, title: 'T', description: long, skill_names: ['a', 'b'], match_percent: 80 },
      { id: 2, title: 'U' },
    ])
    expect(digest).toContain('80% match')
    expect(digest).toContain('...')
    expect(digest).toContain('Skills: a, b')
    expect(e.buildDigestHtml('A', app, [], true)).toContain('match your skills')

    expect(e.buildTaskNudgeHtml('A', 'T', 'P', 1, 2, 10, 'commented', '1 Jan')).toContain(
      `${app}/projects/1#task-2`,
    )
    expect(
      e.buildTaskFinalWarningHtml('A', 'T', 'P', 1, 2, 20, 'commented', '1 Jan', '9 Jan'),
    ).toContain('9 Jan')
    expect(e.buildTaskSurrenderedOwnerHtml('O', 'V', 'T', 'P', 1)).toContain('V')
    expect(e.buildTaskSurrenderedAssigneeHtml('A', 'T', 'P', 1)).toContain(`${app}/projects/1`)
  })

  it('every send helper resolves through the transport', async () => {
    const base = { to: 'a@b.c', name: 'A' }
    const results = await Promise.all([
      e.sendWelcomeAndConfirmEmail({ ...base, token: 't' }),
      e.sendApplicationReceivedEmail(base),
      e.sendApplicationApprovedEmail(base),
      e.sendApplicationRejectedEmail({ ...base, applicantNotes: 'n' }),
      e.sendApplicationNeedsInfoEmail({ ...base, applicantNotes: 'n' }),
      e.sendApplicationReopenedEmail(base),
      e.sendPendingApplicationsSummaryEmail({ ...base, count: 2 }),
      e.sendPasswordResetEmail({ to: 'a@b.c', resetToken: 'r' }),
      e.sendAdminInviteEmail({ to: 'a@b.c', inviteToken: 'i', invitedBy: 'B' }),
      e.sendOutreachLoginEmail({ to: 'a@b.c', loginToken: 'o' }),
      e.sendAdminAlertEmail({ ...base, subject: 'S', message: 'M', ctaLabel: 'L', ctaUrl: '/rel' }),
      e.sendAdminAlertEmail({
        ...base,
        subject: 'S',
        message: 'M',
        ctaLabel: 'L',
        ctaUrl: 'http://abs',
      }),
      e.sendProjectNotificationEmail({
        ...base,
        subject: 'S',
        message: 'M',
        projectTitle: 'P',
        projectId: 1,
      }),
      e.sendLocalGroupSuggestionEmail({ ...base, action: 'declined', groupName: 'G' }),
      e.sendLocalGroupSuggestionEmail({ ...base, action: 'other', groupName: 'G' }),
      e.sendDigestEmail({ ...base, projects: [{ id: 1, title: 'T' }] }),
      e.sendDigestEmail({ ...base, projects: [{ id: 1, title: 'T' }], isMatch: true }),
      e.sendTaskNudgeEmail({
        ...base,
        taskTitle: 'T',
        projectTitle: 'P',
        projectId: 1,
        taskId: 2,
        daysInactive: 3,
        activityPhrase: 'a',
        lastActivityDate: 'd',
      }),
      e.sendTaskFinalWarningEmail({
        ...base,
        taskTitle: 'T',
        projectTitle: 'P',
        projectId: 1,
        taskId: 2,
        daysInactive: 3,
        activityPhrase: 'a',
        lastActivityDate: 'd',
        surrenderDate: 's',
      }),
      e.sendTaskSurrenderedOwnerEmail({
        to: 'a@b.c',
        ownerName: 'O',
        volunteerName: 'V',
        taskTitle: 'T',
        projectTitle: 'P',
        projectId: 1,
      }),
      e.sendTaskSurrenderedAssigneeEmail({
        ...base,
        taskTitle: 'T',
        projectTitle: 'P',
        projectId: 1,
      }),
    ])
    expect(results.every(Boolean)).toBe(true)
    expect(await e.sendDigestEmail({ ...base, projects: [] })).toBe(false)
  })
})
