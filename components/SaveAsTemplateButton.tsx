'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Button from '@/components/Button'
import FormLabel from '@/components/FormLabel'
import Modal from '@/components/ui/Modal'
import { P } from '@/components/Text'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

/**
 * Saves this project's structure (tasks, schedule offsets, dependencies, skills) as a reusable
 * Template — never its country/localGroup/team/assignee — for spinning up as a fresh draft
 * project elsewhere later. See lib/template-porting.ts.
 */
export default function SaveAsTemplateButton({
  projectId,
  defaultTitle,
  className,
}: {
  projectId: number
  defaultTitle: string
  /** The trigger's look, e.g. a row of the menu it sits in. */
  className?: string
}) {
  const showToast = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState('')

  const saveAsTemplate = useMutation({
    ...orpc.templates.saveAsTemplate.mutationOptions(),
    onSuccess: () => {
      setIsOpen(false)
      showToast('Saved as template', 'success')
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Could not save template', 'error'),
  })

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setTitle(defaultTitle)
          setDescription('')
          setIsOpen(true)
        }}
      >
        Save as template
      </button>

      <Modal
        id="save-as-template"
        title="Save as template"
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      >
        <P className="text-text-light mb-4 text-sm">
          Saves this project&apos;s tasks, schedule, dependencies and skills as a reusable template.
          Country, local group, team and assignees are never included — a new project made from this
          template always starts with those blank.
        </P>
        <FormLabel htmlFor="template-title" className="mb-1 block font-medium">
          Template title
        </FormLabel>
        <Input
          id="template-title"
          className="mb-3 w-full"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <FormLabel htmlFor="template-description" className="mb-1 block font-medium">
          Description (optional)
        </FormLabel>
        <Textarea
          id="template-description"
          rows={3}
          className="mb-4 w-full"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            disabled={!title.trim() || saveAsTemplate.isPending}
            onClick={() =>
              saveAsTemplate.mutate({
                projectId,
                title: title.trim(),
                description: description.trim() || null,
              })
            }
          >
            {saveAsTemplate.isPending ? 'Saving…' : 'Save template'}
          </Button>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </>
  )
}
