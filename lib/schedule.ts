/**
 * Timeline scheduling for work items.
 *
 * Pure date arithmetic over ids — this module knows nothing about Prisma, projects or tasks, so
 * the same code runs on the server (to produce the authoritative schedule) and in the browser (to
 * preview a drag before it is saved). Both sides must agree, which is why there is only one copy.
 *
 * The model is finish-to-start with lag. An item is either:
 *   - pinned    — it has a `startDate`, and sits there regardless of what moves around it; or
 *   - derived   — it has none, and starts once every predecessor has finished (+1 day +lag).
 * An item with neither a pin nor a predecessor falls back to the scope's origin.
 */

const MS_PER_DAY = 86_400_000

export type ScheduleInput = {
  id: number
  /** Pinned anchor, or null to derive the start from predecessors. */
  startDate: Date | null
  /** null is read as 1 day. */
  durationDays: number | null
  deadline: Date | null
  baselineStartDate: Date | null
  baselineDurationDays: number | null
  startedAt: Date | null
  completedAt: Date | null
  /** A fixed point the plan is built around. Seeds the critical path — see markCriticalPath. */
  isAnchor?: boolean
}

export type ScheduleEdge = {
  predecessorId: number
  successorId: number
  lagDays: number
}

export type DateSpan = { start: Date; end: Date }

export type ScheduledItem = {
  id: number
  /** Inclusive start of the current schedule. */
  start: Date
  /** Inclusive end — a 1-day item has start === end. */
  end: Date
  isPinned: boolean
  /** Start came from a predecessor rather than from the origin. */
  isDerived: boolean
  /** The deadline as a UTC day, or null when there is none. */
  deadline: Date | null
  /** Planned end minus deadline: positive is days late, zero is on the day, negative is spare. */
  daysLate: number | null
  breachesDeadline: boolean
  /** Pin is earlier than the dependencies allow. The pin wins; this flags the conflict. */
  pinnedBeforePredecessor: boolean
  /** Days the pin would have to move later to satisfy its predecessors; null when it need not. */
  pinConflictDays: number | null
  /** The predecessor that sets the earliest permitted start, when the pin conflicts with it. */
  pinConflictWith: number | null
  /** On a chain that determines when an anchor (or, with no anchors, the scope) lands. */
  isCritical: boolean
  /** This item is itself a fixed point the plan is built around. */
  isAnchor: boolean
  /**
   * Zero duration — a moment rather than a stretch of work. It still occupies its start day for
   * scheduling (a successor follows the day after), but the chart draws it as a diamond so it
   * does not read as a day of work.
   */
  isMilestone: boolean
  baseline: DateSpan | null
  /** `end` null means work has started but not finished. */
  actual: { start: Date; end: Date | null } | null
  startVarianceDays: number | null
  finishVarianceDays: number | null
}

export type Schedule = {
  scheduled: ScheduledItem[]
  byId: Map<number, ScheduledItem>
  /** Earliest start across the scope, or the origin when the scope is empty. */
  start: Date
  /** Latest end across the scope, or the origin when the scope is empty. */
  end: Date
}

/** Midnight UTC on the same calendar day, so day arithmetic never drifts across timezones. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. Both are snapped to UTC days. */
export function diffInDays(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY)
}

/**
 * A duration of `n` days starting on `start` ends on day `n - 1`, so a 1-day item is a point.
 * Zero is a milestone: it still lands on its start day, so a successor follows the day after.
 */
function endOfSpan(start: Date, durationDays: number | null): Date {
  return addDays(start, Math.max(1, durationDays ?? 1) - 1)
}

function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b
}

/**
 * Returns the ids forming a dependency cycle, or null when the graph is acyclic.
 * Call this before writing a new edge — a cycle has no valid schedule, so it is refused
 * rather than stored.
 */
export function findDependencyCycle(edges: ScheduleEdge[]): number[] | null {
  const successors = new Map<number, number[]>()
  for (const edge of edges) {
    const list = successors.get(edge.predecessorId)
    if (list) list.push(edge.successorId)
    else successors.set(edge.predecessorId, [edge.successorId])
  }

  const UNVISITED = 0
  const IN_STACK = 1
  const DONE = 2
  const state = new Map<number, number>()
  const path: number[] = []

  function visit(id: number): number[] | null {
    state.set(id, IN_STACK)
    path.push(id)

    for (const next of successors.get(id) ?? []) {
      const nextState = state.get(next) ?? UNVISITED
      if (nextState === IN_STACK) {
        // `next` is still on the stack, so the walk from it back to here closes a loop.
        return path.slice(path.indexOf(next)).concat(next)
      }
      if (nextState === UNVISITED) {
        const cycle = visit(next)
        if (cycle) return cycle
      }
    }

    path.pop()
    state.set(id, DONE)
    return null
  }

  for (const id of successors.keys()) {
    if ((state.get(id) ?? UNVISITED) === UNVISITED) {
      const cycle = visit(id)
      if (cycle) return cycle
    }
  }
  return null
}

/**
 * Places every item on the calendar.
 *
 * Items are visited in topological order so each one is positioned only after its predecessors
 * are final. Any edge that survives a cycle (which `findDependencyCycle` should have blocked at
 * write time) is dropped here rather than hanging the caller — a schedule that renders is more
 * useful than none.
 */
export function computeSchedule(
  items: ScheduleInput[],
  edges: ScheduleEdge[],
  origin: Date,
): Schedule {
  const scopeOrigin = startOfUtcDay(origin)
  const itemById = new Map(items.map((item) => [item.id, item]))

  // Ignore edges pointing outside this scope; callers assemble scopes independently and a
  // dangling reference must not stall the topological pass.
  const liveEdges = edges.filter(
    (edge) => itemById.has(edge.predecessorId) && itemById.has(edge.successorId),
  )

  const predecessorsOf = new Map<number, ScheduleEdge[]>()
  const successorsOf = new Map<number, ScheduleEdge[]>()
  const indegree = new Map<number, number>(items.map((item) => [item.id, 0]))

  for (const edge of liveEdges) {
    const preds = predecessorsOf.get(edge.successorId)
    if (preds) preds.push(edge)
    else predecessorsOf.set(edge.successorId, [edge])

    const succs = successorsOf.get(edge.predecessorId)
    if (succs) succs.push(edge)
    else successorsOf.set(edge.predecessorId, [edge])

    indegree.set(edge.successorId, (indegree.get(edge.successorId) ?? 0) + 1)
  }

  const queue = items.filter((item) => (indegree.get(item.id) ?? 0) === 0).map((item) => item.id)
  const order: number[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const edge of successorsOf.get(id) ?? []) {
      const remaining = (indegree.get(edge.successorId) ?? 0) - 1
      indegree.set(edge.successorId, remaining)
      if (remaining === 0) queue.push(edge.successorId)
    }
  }
  // Anything left has an indegree that never reached zero, i.e. it sits on a cycle. Append it in
  // input order so it is still drawn, just without dependency-derived placement.
  if (order.length < items.length) {
    const placed = new Set(order)
    for (const item of items) if (!placed.has(item.id)) order.push(item.id)
  }

  const spans = new Map<number, DateSpan>()
  const results = new Map<number, ScheduledItem>()
  const scheduledInOrder: ScheduledItem[] = []

  for (const id of order) {
    const item = itemById.get(id)!
    const preds = predecessorsOf.get(id) ?? []

    let earliest = scopeOrigin
    let isDerived = false
    let bindingPredecessor: number | null = null
    for (const edge of preds) {
      const predSpan = spans.get(edge.predecessorId)
      if (!predSpan) continue // predecessor sat on a cycle; ignore this constraint
      isDerived = true
      const permitted = addDays(predSpan.end, 1 + edge.lagDays)
      if (bindingPredecessor === null || permitted.getTime() > earliest.getTime()) {
        bindingPredecessor = edge.predecessorId
      }
      earliest = laterOf(earliest, permitted)
    }

    const pinned = item.startDate ? startOfUtcDay(item.startDate) : null
    const start = pinned ?? earliest
    const end = endOfSpan(start, item.durationDays)
    spans.set(id, { start, end })

    const baseline =
      item.baselineStartDate === null
        ? null
        : (() => {
            const baseStart = startOfUtcDay(item.baselineStartDate!)
            return { start: baseStart, end: endOfSpan(baseStart, item.baselineDurationDays) }
          })()

    const actual =
      item.startedAt === null
        ? null
        : {
            start: startOfUtcDay(item.startedAt),
            end: item.completedAt ? startOfUtcDay(item.completedAt) : null,
          }

    const deadline = item.deadline ? startOfUtcDay(item.deadline) : null
    const daysLate = deadline ? diffInDays(deadline, end) : null
    const pinConflict = pinned !== null && isDerived && pinned.getTime() < earliest.getTime()

    const scheduledItem: ScheduledItem = {
      id,
      start,
      end,
      isPinned: pinned !== null,
      isDerived: isDerived && pinned === null,
      deadline,
      daysLate,
      breachesDeadline: daysLate !== null && daysLate > 0,
      pinnedBeforePredecessor: pinConflict,
      pinConflictDays: pinConflict ? diffInDays(pinned, earliest) : null,
      pinConflictWith: pinConflict ? bindingPredecessor : null,
      isCritical: false,
      isAnchor: item.isAnchor === true,
      isMilestone: item.durationDays === 0,
      baseline,
      actual,
      startVarianceDays: baseline ? diffInDays(baseline.start, start) : null,
      finishVarianceDays: baseline ? diffInDays(baseline.end, end) : null,
    }
    results.set(id, scheduledItem)
    scheduledInOrder.push(scheduledItem)
  }

  markCriticalPath(scheduledInOrder, results, successorsOf)

  const scheduled = items.map((item) => results.get(item.id)!)
  const scopeStart = scheduled.reduce(
    (acc, item) => (item.start.getTime() < acc.getTime() ? item.start : acc),
    scheduled.length > 0 ? scheduled[0].start : scopeOrigin,
  )
  const scopeEnd = scheduled.reduce(
    (acc, item) => (item.end.getTime() > acc.getTime() ? item.end : acc),
    scheduled.length > 0 ? scheduled[0].end : scopeOrigin,
  )

  return { scheduled, byId: results, start: scopeStart, end: scopeEnd }
}

/**
 * Marks the chains that determine when the things that matter land.
 *
 * What "matters" is the anchors — the fixed points a plan is built around, like the date of the
 * event itself. Criticality is seeded from them and propagates backwards: an item is critical
 * when a critical successor starts exactly at the moment this one permits, so slipping it slips
 * the anchor. Work that merely *follows* an anchor — the write-up, the press release — is on no
 * such chain, and is correctly left slack however late it finishes.
 *
 * With no anchor set there is nothing to aim at, so the scope's own finish stands in for one and
 * the latest-finishing items seed the walk instead. That is the classic reading of a critical
 * path, and it is what every project gets until someone names an anchor.
 */
function markCriticalPath(
  order: ScheduledItem[],
  results: Map<number, ScheduledItem>,
  successorsOf: Map<number, ScheduleEdge[]>,
): void {
  if (results.size === 0) return

  const anchors = [...results.values()].filter((item) => item.isAnchor)

  let latest = -Infinity
  if (anchors.length === 0) {
    for (const item of results.values()) latest = Math.max(latest, item.end.getTime())
  }
  const isSeed = (item: ScheduledItem) =>
    anchors.length > 0 ? item.isAnchor : item.end.getTime() === latest

  for (let i = order.length - 1; i >= 0; i--) {
    const item = order[i]

    if (isSeed(item)) {
      item.isCritical = true
      continue
    }
    item.isCritical = (successorsOf.get(item.id) ?? []).some((edge) => {
      const successor = results.get(edge.successorId)
      if (!successor?.isCritical) return false
      // The successor is only held up by this item if it starts the moment this one permits.
      return successor.start.getTime() === addDays(item.end, 1 + edge.lagDays).getTime()
    })
  }
}
