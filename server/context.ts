import { getCurrentVolunteer, extractToken } from '@/lib/auth'
import { wantsVolunteerView, withoutAdminRights } from '@/lib/view-as'

export async function createContext(request: Request) {
  const authorization = request.headers.get('authorization')
  const signedIn = await getCurrentVolunteer(authorization)
  const viewingAsVolunteer = Boolean(signedIn?.isAdmin) && wantsVolunteerView(request)
  const volunteer = signedIn && viewingAsVolunteer ? withoutAdminRights(signedIn) : signedIn
  return { volunteer, viewingAsVolunteer, token: extractToken(authorization), request }
}

export type Context = Awaited<ReturnType<typeof createContext>>
