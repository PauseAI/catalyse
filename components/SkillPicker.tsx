'use client'

import { useQuery } from '@tanstack/react-query'
import FilterDropdown from '@/components/FilterDropdown'
import FormLabel from '@/components/FormLabel'
import { orpc } from '@/lib/orpc'

interface SelectedSkill {
  skillId: number
  proficiencyLevel: string
}

interface SkillPickerProps {
  value: SelectedSkill[]
  onChange: (skills: SelectedSkill[]) => void
  showProficiency?: boolean
}

export default function SkillPicker({
  value,
  onChange,
  showProficiency = false,
}: SkillPickerProps) {
  const { data: categories = [], isPending: loading } = useQuery(orpc.skills.list.queryOptions())

  function toggle(skillId: number) {
    const existing = value.find((s) => s.skillId === skillId)
    if (existing) {
      onChange(value.filter((s) => s.skillId !== skillId))
    } else {
      onChange([...value, { skillId, proficiencyLevel: 'intermediate' }])
    }
  }

  function setProficiency(skillId: number, level: string) {
    onChange(value.map((s) => (s.skillId === skillId ? { ...s, proficiencyLevel: level } : s)))
  }

  if (loading) return <div className="loading">Loading skills…</div>

  return (
    <div>
      {categories.map((cat) => (
        <div key={cat.id} className="mb-4">
          <div className="font-semibold mb-2 text-brand-text">{cat.name}</div>
          <div className="flex flex-wrap gap-2">
            {cat.skills.map((skill) => {
              const selected = value.find((s) => s.skillId === skill.id)
              return (
                <div key={skill.id} className="flex flex-col gap-1">
                  {/* [test hook] skill-option class used as test selector */}
                  <FormLabel
                    className={`skill-option relative inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-bg border-2 border-transparent rounded-full cursor-pointer transition-all text-sm select-none hover:bg-accent${selected ? ' bg-secondary! text-white! border-secondary-dark!' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={!!selected}
                      onChange={() => toggle(skill.id)}
                      className="absolute opacity-0 w-0 h-0 pointer-events-none"
                    />
                    {skill.name}
                  </FormLabel>
                  {showProficiency && selected && (
                    <FilterDropdown
                      id={`proficiency-${skill.id}`}
                      label="Proficiency"
                      ariaLabel="Proficiency"
                      value={selected.proficiencyLevel}
                      options={[
                        { value: 'beginner', label: 'Beginner' },
                        { value: 'intermediate', label: 'Intermediate' },
                        { value: 'expert', label: 'Expert' },
                      ]}
                      onChange={(v) => setProficiency(skill.id, v)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
