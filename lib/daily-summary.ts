/**
 * The daily summary email: one per person per day, and only when there is something to say.
 * The job collects lines; this groups and orders them so the most urgent read first.
 */

export type SummaryLineKind =
  | 'needs_decision'
  | 'overdue'
  | 'at_risk'
  | 'past_deadline'
  | 'plan_slip'
  | 'due_today'
  | 'due_tomorrow'
  | 'check_in'
  | 'activity'

export type SummaryLine = {
  /** As the person doing the task, or as someone who leads its project. */
  role: 'assignee' | 'owner'
  kind: SummaryLineKind
  /** The project the line is about, or "Quick Tasks". */
  group: string
  text: string
  href: string
}

export type SummarySection = {
  heading: string
  lines: SummaryLine[]
  /** One of the projects the person leads, listed under "Projects you lead". */
  project?: true
}

const ORDER: Record<SummaryLineKind, number> = {
  needs_decision: 0,
  overdue: 1,
  at_risk: 2,
  past_deadline: 3,
  plan_slip: 4,
  due_today: 5,
  due_tomorrow: 6,
  check_in: 7,
  activity: 8,
}

/** The kinds that count towards "N things need you today". */
const URGENT: SummaryLineKind[] = ['needs_decision', 'overdue', 'at_risk', 'due_today']

const byUrgency = (a: SummaryLine, b: SummaryLine) => ORDER[a.kind] - ORDER[b.kind]

/**
 * Decisions first, then my own tasks, then each project I lead with its most urgent lines on
 * top. Empty sections are left out.
 */
export function summarySections(lines: SummaryLine[]): SummarySection[] {
  const sections: SummarySection[] = []
  const decisions = lines.filter((l) => l.kind === 'needs_decision')
  if (decisions.length > 0) sections.push({ heading: 'Needs your decision', lines: decisions })

  const mine = lines.filter((l) => l.role === 'assignee').sort(byUrgency)
  if (mine.length > 0) sections.push({ heading: 'Your tasks', lines: mine })

  const led = lines.filter((l) => l.role === 'owner' && l.kind !== 'needs_decision')
  const groups = new Map<string, SummaryLine[]>()
  for (const l of led) groups.set(l.group, [...(groups.get(l.group) ?? []), l])
  const projects = [...groups.entries()]
    .map(([heading, ls]) => ({ heading, lines: ls.sort(byUrgency), project: true as const }))
    .sort((a, b) => ORDER[a.lines[0].kind] - ORDER[b.lines[0].kind])
  sections.push(...projects)
  return sections
}

/** "Catalyse: 3 things need you today", or a quieter subject when nothing is urgent. */
export function summarySubject(lines: SummaryLine[]): string {
  const urgent = lines.filter((l) => URGENT.includes(l.kind)).length
  if (urgent === 0) return 'Catalyse: your daily summary'
  return `Catalyse: ${urgent} ${urgent === 1 ? 'thing needs' : 'things need'} you today`
}
