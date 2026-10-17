import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import Button from '@/components/Button'
import ConfirmDialog from './ConfirmDialog'

const meta: Meta<typeof ConfirmDialog> = {
  title: 'Atoms/ConfirmDialog',
  component: ConfirmDialog,
}

export default meta
type Story = StoryObj<typeof ConfirmDialog>

export const Default: Story = {
  render: () => {
    function Demo() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Complete project</Button>
          <ConfirmDialog
            id="demo-confirm"
            isOpen={open}
            title="Complete 'Translate the site'?"
            body="Completing it locks the project: nobody can change it or its tasks until its owner or an admin reopens it."
            confirmLabel="Complete project"
            onConfirm={() => setOpen(false)}
            onClose={() => setOpen(false)}
          />
        </>
      )
    }
    return <Demo />
  },
}

/** `danger` for a destructive confirmation; `busy` disables both buttons mid-request. */
export const DangerBusy: Story = {
  render: () => {
    function Demo() {
      const [open, setOpen] = useState(true)
      const [busy, setBusy] = useState(false)
      return (
        <>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Delete task
          </Button>
          <ConfirmDialog
            id="demo-confirm-danger"
            isOpen={open}
            title="Delete 'Draft the newsletter'?"
            body="This can't be undone."
            confirmLabel="Delete"
            busyLabel="Deleting…"
            danger
            busy={busy}
            onConfirm={() => setBusy(true)}
            onClose={() => setOpen(false)}
          />
        </>
      )
    }
    return <Demo />
  },
}
