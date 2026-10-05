'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Button from '@/components/Button'
import SkillPicker from '@/components/SkillPicker'
import { orpc } from '@/lib/orpc'
import { textMatches } from '@/lib/text-match'

interface SelectedSkill {
  skillId: number
  proficiencyLevel: string
}

/**
 * Sign-up's skill choice: the skills live projects need most, anything already picked, and a
 * search across every skill, with the full list by category behind "Show all skills".
 */
export default function SignupSkills({
  value,
  onChange,
}: {
  value: SelectedSkill[]
  onChange: (skills: SelectedSkill[]) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')
  const { data: needed = [] } = useQuery(orpc.skills.mostNeeded.queryOptions())
  const { data: categories = [] } = useQuery(orpc.skills.list.queryOptions())
  const all = categories.flatMap((c) => c.skills)

  if (showAll) {
    return (
      <>
        <SkillPicker value={value} onChange={onChange} />
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(false)}>
          Show fewer skills
        </Button>
      </>
    )
  }

  const selectedIds = new Set(value.map((s) => s.skillId))
  const term = search.trim()
  const shown = term
    ? all.filter((s) => textMatches(s.name, term))
    : [...needed, ...all.filter((s) => selectedIds.has(s.id) && !needed.some((n) => n.id === s.id))]

  function toggle(skillId: number) {
    onChange(
      selectedIds.has(skillId)
        ? value.filter((s) => s.skillId !== skillId)
        : [...value, { skillId, proficiencyLevel: 'intermediate' }],
    )
  }

  return (
    <div>
      <label htmlFor="skill-search">Search skills</label>
      <input
        id="skill-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="e.g. design, writing, events"
        className="mb-3"
      />
      {!term && needed.length > 0 && (
        <p className="text-sm text-text-light mt-0 mb-2">Most needed by projects right now:</p>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-text-light">
          {term ? 'No skills match that search.' : 'Choose from the full list below.'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          {shown.map((skill) => (
            // [test hook] skill-option class used as test selector
            <label
              key={skill.id}
              className={`skill-option relative inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-bg border-2 border-transparent rounded-full cursor-pointer transition-all text-sm select-none hover:bg-accent${selectedIds.has(skill.id) ? ' bg-secondary! text-white! border-secondary-dark!' : ''}`}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(skill.id)}
                onChange={() => toggle(skill.id)}
                className="absolute opacity-0 w-0 h-0 pointer-events-none"
              />
              {skill.name}
            </label>
          ))}
        </div>
      )}
      <Button type="button" variant="secondary" size="sm" onClick={() => setShowAll(true)}>
        Show all skills
      </Button>
    </div>
  )
}
