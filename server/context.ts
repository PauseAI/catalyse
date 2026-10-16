import { getCurrentVolunteer, extractToken } from '@/lib/auth'
import { isStaff } from '@/lib/chapter-access'
import { loadAccess } from '@/lib/chapter-access-server'
import { wantsVolunteerView, withoutAdminRights, withoutChapterRights } from '@/lib/view-as'

export async function createContext(request: Request) {
  const authorization = request.headers.get('authorization')
  const signedIn = await getCurrentVolunteer(authorization)
  const signedInAccess = await loadAccess(signedIn)
  const viewingAsVolunteer =
    (Boolean(signedIn?.isAdmin) || isStaff(signedInAccess)) && wantsVolunteerView(request)
  const volunteer = signedIn && viewingAsVolunteer ? withoutAdminRights(signedIn) : signedIn
  const access = viewingAsVolunteer ? withoutChapterRights(signedInAccess) : signedInAccess
  return { volunteer, access, viewingAsVolunteer, token: extractToken(authorization), request }
}

export type Context = Awaited<ReturnType<typeof createContext>>
