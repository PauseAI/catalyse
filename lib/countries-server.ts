import { prisma } from './prisma'

/** Every country, enabled or not, by name. */
export function listCountries() {
  return prisma.country.findMany({
    select: { code: true, name: true, enabled: true },
    orderBy: { name: 'asc' },
  })
}

/** How a stored country is shown: its name, or the value itself when it is not listed. */
export async function countryName(code: string): Promise<string> {
  return (await prisma.country.findUnique({ where: { code } }))?.name ?? code
}

export async function isEnabledCountry(code: string): Promise<boolean> {
  return (await prisma.country.findUnique({ where: { code } }))?.enabled ?? false
}
