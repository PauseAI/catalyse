import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import Button from '@/components/Button'
import Modal from './Modal'

const meta: Meta<typeof Modal> = {
  title: 'Atoms/Modal',
  component: Modal,
}

export default meta
type Story = StoryObj<typeof Modal>

/** Controlled by `isOpen`/`onClose`, so the story opens it itself to show the real interaction. */
export const Default: Story = {
  render: () => {
    function Demo() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open modal</Button>
          <Modal id="demo-modal" title="Message Sam" isOpen={open} onClose={() => setOpen(false)}>
            <p className="text-text-light">This is sent as a direct message, not posted here.</p>
          </Modal>
        </>
      )
    }
    return <Demo />
  },
}

export const Wide: Story = {
  render: () => {
    function Demo() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open wide modal</Button>
          <Modal
            id="demo-modal-wide"
            title="Import diff"
            size="wide"
            isOpen={open}
            onClose={() => setOpen(false)}
          >
            <p className="text-text-light">
              A wide modal holds a working surface — a diff, a form.
            </p>
          </Modal>
        </>
      )
    }
    return <Demo />
  },
}
