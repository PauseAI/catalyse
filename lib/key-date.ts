/**
 * Which side of the key date each task sits on, read from the dependencies: the work the key
 * date waits for (its predecessors, however far back) is before it; the work that waits for it
 * is after it. A task on neither chain is "other". With no key date there are no sides.
 */

export type KeyDateSide = 'before' | 'key' | 'after' | 'other'

export const KEY_DATE_SIDE_LABELS: Record<Exclude<KeyDateSide, 'other'>, string> = {
  before: 'Before the key date',
  key: '★ Key date',
  after: 'After the key date',
}

export function keyDateSides(
  tasks: { id: number; isAnchor: boolean }[],
  edges: { predecessorId: number; successorId: number }[],
): Map<number, KeyDateSide> {
  const sides = new Map<number, KeyDateSide>()
  const anchors = tasks.filter((t) => t.isAnchor).map((t) => t.id)
  if (anchors.length === 0) return sides

  const walk = (from: number[], next: (id: number) => number[]) => {
    const seen = new Set<number>()
    const queue = [...from]
    for (let i = 0; i < queue.length; i++) {
      for (const id of next(queue[i])) {
        if (!seen.has(id)) {
          seen.add(id)
          queue.push(id)
        }
      }
    }
    return seen
  }
  const before = walk(anchors, (id) =>
    edges.filter((e) => e.successorId === id).map((e) => e.predecessorId),
  )
  const after = walk(anchors, (id) =>
    edges.filter((e) => e.predecessorId === id).map((e) => e.successorId),
  )

  for (const t of tasks) {
    // Work between two key dates is prep for the later one, so "before" wins.
    sides.set(
      t.id,
      t.isAnchor ? 'key' : before.has(t.id) ? 'before' : after.has(t.id) ? 'after' : 'other',
    )
  }
  return sides
}

const SIDE_ORDER: Record<KeyDateSide, number> = { before: 0, key: 1, after: 2, other: 3 }

/** Sorts before, key date, after, other; keeps the existing order within each side. */
export function bySide<T extends { id: number }>(items: T[], sides: Map<number, KeyDateSide>): T[] {
  if (sides.size === 0) return items
  return items
    .map((item, i) => ({ item, i }))
    .sort(
      (a, b) =>
        SIDE_ORDER[sides.get(a.item.id) ?? 'other'] - SIDE_ORDER[sides.get(b.item.id) ?? 'other'] ||
        a.i - b.i,
    )
    .map(({ item }) => item)
}
