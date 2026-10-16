/** The addresses test/setup-db.ts lists in ADMIN_EMAILS, so createAdmin can make global admins. */
export const GLOBAL_ADMIN_SLOTS = 500

export const globalAdminEmail = (n: number) => {
  if (n >= GLOBAL_ADMIN_SLOTS) throw new Error('createAdmin: raise GLOBAL_ADMIN_SLOTS')
  return `global-admin${n}@example.com`
}
