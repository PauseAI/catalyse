// An admin can browse the site as a volunteer would see it. The choice lives in the browser
// and rides on every RPC as a header; the server honours it only by taking admin rights away,
// so a forged header can never grant anything.
export const VIEW_AS_HEADER = 'x-view-as'
export const VIEW_AS_STORAGE_KEY = 'viewAs'

export function isViewingAsVolunteer(): boolean {
  return localStorage.getItem(VIEW_AS_STORAGE_KEY) === 'volunteer'
}

export function setViewingAsVolunteer(on: boolean): void {
  if (on) localStorage.setItem(VIEW_AS_STORAGE_KEY, 'volunteer')
  else localStorage.removeItem(VIEW_AS_STORAGE_KEY)
}

/** Whether this request asks an admin's session to be treated as a volunteer's. */
export function wantsVolunteerView(request: Request): boolean {
  return request.headers.get(VIEW_AS_HEADER) === 'volunteer'
}

/** The volunteer with every admin right removed. */
export function withoutAdminRights<
  T extends { isAdmin: boolean | null; isTechnicalAdmin: boolean | null },
>(volunteer: T): T {
  return { ...volunteer, isAdmin: false, isTechnicalAdmin: false }
}
