import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  chapterFor,
  createAdmin,
  createChapterLead,
  createMember,
  createVolunteer,
} from '@/test/factories'
import { anon, clientAs } from '@/test/rpc'

const enabled = async (code: string) =>
  (await prisma.country.findUniqueOrThrow({ where: { code } })).enabled

const setEnabled = (code: string, on: boolean) =>
  prisma.country.update({ where: { code }, data: { enabled: on } })

describe('countries.list', () => {
  it('gives anyone every country by name, the ones the migration left disabled included', async () => {
    const countries = await anon().countries.list()
    expect(countries).toContainEqual({ code: 'UK', name: 'United Kingdom', enabled: true })
    expect(countries).toContainEqual({ code: 'Austria', name: 'Austria', enabled: false })
    expect(countries.map((c) => c.name)).toEqual(countries.map((c) => c.name).sort())
  })
})

describe('admin.countries.setEnabled', () => {
  it('is for global admins only', async () => {
    const lead = await createChapterLead(await chapterFor('UK'))
    const input = { code: 'Austria', enabled: true }
    await expect(anon().admin.countries.setEnabled(input)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    await expect(
      clientAs(await createVolunteer()).admin.countries.setEnabled(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(clientAs(lead).admin.countries.setEnabled(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await enabled('Austria')).toBe(false)
  })

  it('turns a country off and on again, and refuses one that is not listed', async () => {
    const admin = clientAs(await createAdmin())
    expect(await admin.admin.countries.setEnabled({ code: 'Kenya', enabled: false })).toEqual({
      code: 'Kenya',
      name: 'Kenya',
      enabled: false,
    })
    expect(await enabled('Kenya')).toBe(false)
    await admin.admin.countries.setEnabled({ code: 'Kenya', enabled: true })
    expect(await enabled('Kenya')).toBe(true)
    await expect(
      admin.admin.countries.setEnabled({ code: 'Atlantis', enabled: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('a disabled country', () => {
  it('cannot be newly chosen, while whoever already gave it keeps it', async () => {
    await setEnabled('Nigeria', false)
    const already = await createVolunteer({ country: 'Nigeria' })

    const mover = await createMember(await chapterFor('UK'))
    await expect(
      clientAs(mover).chapterTransfers.request({ country: 'Nigeria', reason: null }),
    ).rejects.toMatchObject({ message: 'Choose your country from the list' })

    const unplaced = await createVolunteer()
    await expect(
      clientAs(unplaced).volunteers.updateMe({ country: 'Nigeria' }),
    ).rejects.toMatchObject({ message: 'Choose your country from the list' })
    await clientAs(already).volunteers.updateMe({ bio: 'Still living in Nigeria, and saying so.' })
    expect((await prisma.volunteer.findUniqueOrThrow({ where: { id: already.id } })).country).toBe(
      'Nigeria',
    )
    await setEnabled('Nigeria', true)
  })

  it('is enabled when a local group suggested there is accepted', async () => {
    const chapter = await chapterFor('Poland')
    await setEnabled('Poland', false)
    // Someone in the holding pool may suggest a group in a country not yet enabled.
    const suggestion = await clientAs(await createVolunteer()).localGroupSuggestions.create({
      name: 'Kraków',
      country: 'Poland',
    })
    await prisma.localGroupSuggestion.update({
      where: { id: suggestion.id },
      data: { nationalChapterId: chapter.id },
    })
    await clientAs(await createAdmin()).admin.localGroups.reviewSuggestion({
      id: suggestion.id,
      action: 'accept',
    })
    expect(await enabled('Poland')).toBe(true)
    expect(await prisma.localGroup.count({ where: { name: 'Kraków' } })).toBe(1)
  })

  it('can have a chapter opened for it, which enables it', async () => {
    const admin = clientAs(await createAdmin())
    const { availableCountries } = await admin.admin.chapters.list()
    expect(availableCountries).toContainEqual({ value: 'Brazil', label: 'Brazil' })
    expect(await admin.admin.chapters.create({ country: 'Brazil' })).toMatchObject({
      name: 'Brazil',
    })
    expect(await enabled('Brazil')).toBe(true)
  })
})
