import { prisma } from './prisma'
import type { Prisma } from '@/generated/prisma/client'
import { defaultDelivery, isFixed, type Delivery, type Recipient } from './notification-types'

/** What `volunteerId` has chosen, by type. */
export async function chosenDeliveries(volunteerId: number): Promise<Map<string, Delivery>> {
  const rows = await prisma.notificationPreference.findMany({
    where: { volunteerId },
    select: { type: true, delivery: true },
  })
  return new Map(rows.map((r) => [r.type, r.delivery]))
}

/**
 * Saves choices for the given types: a choice equal to the type's default is stored as no choice,
 * so the person follows the default if it changes. Types left out keep what they had.
 */
export async function saveDeliveries(
  tx: Prisma.TransactionClient,
  volunteerId: number,
  who: Recipient,
  choices: Record<string, Delivery>,
): Promise<void> {
  const entries = Object.entries(choices)
  await tx.notificationPreference.deleteMany({
    where: { volunteerId, type: { in: entries.map(([type]) => type) } },
  })
  await tx.notificationPreference.createMany({
    data: entries
      .filter(([type, delivery]) => delivery !== defaultDelivery(type, who))
      .map(([type, delivery]) => ({ volunteerId, type, delivery })),
  })
}

/** The types in `choices` that cannot be chosen: unknown, or fixed. */
export function unchoosableTypes(choices: Record<string, Delivery>): string[] {
  return Object.keys(choices).filter(
    (t) => defaultDelivery(t, { isTechnicalAdmin: false }) === null || isFixed(t),
  )
}
