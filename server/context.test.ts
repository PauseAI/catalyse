import { describe, it, expect } from 'vitest'
import {
  createChapter,
  createChapterLead,
  createSuperAdmin,
  createVolunteer,
} from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { createSession } from '@/lib/auth'
import { VIEW_AS_HEADER } from '@/lib/view-as'
import { createContext } from './context'

describe('createContext', () => {
  it('resolves the volunteer and raw token from the Authorization header', async () => {
    const vol = await createVolunteer()
    const token = await createSession(vol.id)
    const req = new Request('http://localhost/api/rpc', {
      headers: { authorization: `Bearer ${token}` },
    })
    const ctx = await createContext(req)
    expect(ctx.volunteer?.id).toBe(vol.id)
    expect(ctx.token).toBe(token)
    expect(ctx.request).toBe(req)
    expect(ctx.viewingAsVolunteer).toBe(false)
    const anon = await createContext(new Request('http://localhost/api/rpc'))
    expect(anon).toMatchObject({ volunteer: null, token: null, viewingAsVolunteer: false })
  })

  it('strips admin rights from an admin who asks to view as a volunteer', async () => {
    const admin = await createSuperAdmin({ isTechnicalAdmin: true })
    const contextFor = (token: string, view: string) =>
      createContext(
        new Request('http://localhost/api/rpc', {
          headers: { authorization: `Bearer ${token}`, [VIEW_AS_HEADER]: view },
        }),
      )
    const token = await createSession(admin.id)

    const ctx = await contextFor(token, 'volunteer')
    expect(ctx.viewingAsVolunteer).toBe(true)
    expect(ctx.volunteer).toMatchObject({ id: admin.id, isAdmin: false, isTechnicalAdmin: false })
    const c = clientAs(ctx.volunteer, ctx)
    await expect(c.admin.admins.list()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await c.auth.me()).toMatchObject({
      isAdmin: false,
      isSuperAdmin: false,
      viewingAsVolunteer: true,
    })

    // Any other value leaves the admin view alone.
    const adminCtx = await contextFor(token, 'admin')
    expect(adminCtx).toMatchObject({ viewingAsVolunteer: false, volunteer: { isAdmin: true } })
    expect(await clientAs(adminCtx.volunteer, adminCtx).auth.me()).toMatchObject({
      isAdmin: true,
      isSuperAdmin: true,
      viewingAsVolunteer: false,
    })

    // A chapter's staff can view as a member too: they keep their chapter and lose the role.
    const chapter = await createChapter()
    const lead = await createChapterLead(chapter)
    const leadToken = await createSession(lead.id)
    expect((await contextFor(leadToken, 'admin')).access).toEqual({
      globalAdmin: false,
      chapterId: chapter.id,
      role: 'LEAD',
    })
    const leadView = await contextFor(leadToken, 'volunteer')
    expect(leadView).toMatchObject({
      viewingAsVolunteer: true,
      access: { globalAdmin: false, chapterId: chapter.id, role: null },
    })
    expect(await clientAs(leadView.volunteer, leadView).auth.me()).toMatchObject({
      chapter: { id: chapter.id, country: chapter.country },
      access: { role: null },
    })

    // The header only ever takes rights away; a volunteer sending it is unchanged.
    const vol = await createVolunteer()
    const volCtx = await contextFor(await createSession(vol.id), 'volunteer')
    expect(volCtx).toMatchObject({ viewingAsVolunteer: false, volunteer: { id: vol.id } })
  })
})
