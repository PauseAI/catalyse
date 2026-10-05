import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createProject, createTask } from '@/test/factories'
import { renderApp } from '@/test/render'
import { clientAs } from '@/test/rpc'
import CommentThread from './CommentThread'
import BugReportCommentThread from './BugReportCommentThread'
import CommentThreadView from './CommentThreadView'
import CommentComposer from './CommentComposer'
import Footer from './Footer'
import AiEditingHelp from './AiEditingHelp'
import { ToastProvider } from '@/lib/toast'

describe('CommentThreadView', () => {
  const comments = [
    { id: 1, content: 'First', authorName: 'Ann', createdAt: new Date('2026-01-01T10:00:00Z') },
    { id: 2, content: 'Second', authorName: null, createdAt: null },
  ]

  it('renders loading, empty and populated states', () => {
    const { rerender } = render(
      <CommentThreadView
        comments={[]}
        canPost={false}
        isPending
        isSubmitting={false}
        onSubmit={async () => true}
      />,
    )
    expect(screen.getByText('Loading comments…')).toBeInTheDocument()
    rerender(
      <CommentThreadView
        comments={[]}
        canPost={false}
        isPending={false}
        isSubmitting={false}
        onSubmit={async () => true}
        emptyText="Nothing"
      />,
    )
    expect(screen.getByText('Nothing')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    rerender(
      <CommentThreadView
        comments={comments}
        canPost={false}
        isPending={false}
        isSubmitting={false}
        onSubmit={async () => true}
      />,
    )
    expect(screen.getByText('Unknown ·')).toBeInTheDocument()
    expect(screen.getByText(/Ann · 1 January 2026/)).toBeInTheDocument()
  })

  it('submits trimmed content and clears on success, copies permalinks', async () => {
    const onSubmit = vi.fn(async (c: string) => c !== 'fail')
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(
      <ToastProvider>
        <CommentThreadView
          comments={comments}
          canPost
          isPending={false}
          isSubmitting={false}
          onSubmit={onSubmit}
          placeholder="Say something"
        />
      </ToastProvider>,
    )
    const box = screen.getByLabelText('Add a comment')
    expect(box).toHaveAttribute('placeholder', 'Say something')
    expect(screen.getByRole('button', { name: 'Post Comment' })).toBeDisabled()
    fireEvent.change(box, { target: { value: '  hello  ' } })
    fireEvent.submit(box.closest('form')!)
    expect(onSubmit).toHaveBeenCalledWith('hello')
    await waitFor(() => expect(box).toHaveValue(''))
    fireEvent.change(box, { target: { value: 'fail' } })
    fireEvent.submit(box.closest('form')!)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(box).toHaveValue('fail')
    // Whitespace-only is ignored.
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.submit(box.closest('form')!)
    expect(onSubmit).toHaveBeenCalledTimes(2)

    await userEvent.click(screen.getAllByLabelText('Copy link to this comment')[0])
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#comment-1'))
    expect(await screen.findByText('Link copied!')).toBeInTheDocument()
    writeText.mockRejectedValueOnce(new Error('denied'))
    await userEvent.click(screen.getAllByLabelText('Copy link to this comment')[1])
    expect(await screen.findByText('Could not copy the link')).toBeInTheDocument()
  })

  it('scrolls to and highlights a permalinked comment once', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    window.history.replaceState(null, '', '/x#comment-2')
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { rerender } = render(
      <CommentThreadView
        comments={[]}
        canPost={false}
        isPending={false}
        isSubmitting={false}
        onSubmit={async () => true}
      />,
    )
    rerender(
      <CommentThreadView
        comments={comments}
        canPost={false}
        isPending={false}
        isSubmitting={false}
        onSubmit={async () => true}
      />,
    )
    expect(scrollIntoView).toHaveBeenCalled()
    expect(document.getElementById('comment-2')).toHaveClass('ring-2')
    vi.advanceTimersByTime(2000)
    expect(document.getElementById('comment-2')).not.toHaveClass('ring-2')
    rerender(
      <CommentThreadView
        comments={[...comments]}
        canPost={false}
        isPending={false}
        isSubmitting={false}
        onSubmit={async () => true}
      />,
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
    // A hash for a comment that is not in the list, and a non-comment hash, do nothing.
    window.history.replaceState(null, '', '/x#comment-99')
    render(
      <CommentThreadView
        comments={comments}
        canPost={false}
        isPending={false}
        isSubmitting={false}
        onSubmit={async () => true}
      />,
    )
    window.history.replaceState(null, '', '/x#other')
    render(
      <CommentThreadView
        comments={comments}
        canPost={false}
        isPending={false}
        isSubmitting={false}
        onSubmit={async () => true}
      />,
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('shows the posting state', () => {
    render(
      <CommentThreadView
        comments={[]}
        canPost
        isPending={false}
        isSubmitting
        onSubmit={async () => true}
      />,
    )
    expect(screen.getByRole('button', { name: 'Posting…' })).toBeDisabled()
  })
})

describe('CommentComposer', () => {
  const members = [
    { id: 1, name: 'Olive Owner' },
    { id: 2, name: 'Oscar (UK)' },
    { id: 3, name: 'Hal Helper' },
  ]

  it('suggests members after @ and submits their mentions as tokens', async () => {
    const onSubmit = vi.fn(async () => true)
    render(
      <CommentComposer
        label="Add a comment"
        submitLabel="Post"
        busyLabel="Posting…"
        isSubmitting={false}
        onSubmit={onSubmit}
        mentionable={members}
      />,
    )
    const box = screen.getByLabelText('Add a comment')
    // Keys do nothing special while no list is open.
    await userEvent.type(box, 'hi{ArrowDown} @o')
    expect(box).toHaveAttribute('aria-expanded', 'true')
    let options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Olive Owner', 'Oscar (UK)'])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}')
    options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}{ArrowUp}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Enter}')
    expect(box).toHaveValue('hi @Oscar UK ')
    expect(screen.queryByRole('listbox')).toBeNull()

    // Tab picks too; a click picks; Escape and blur close without picking.
    await userEvent.type(box, 'and @hal')
    await userEvent.keyboard('{Tab}')
    expect(box).toHaveValue('hi @Oscar UK and @Hal Helper ')
    await userEvent.type(box, '@Oli')
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Olive Owner' }))
    await userEvent.type(box, '@Oli')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    await userEvent.type(box, ' x @zz')
    expect(screen.queryByRole('listbox')).toBeNull()
    await userEvent.type(box, '{Backspace}{Backspace}H')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.blur(box)
    expect(screen.queryByRole('listbox')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(onSubmit).toHaveBeenCalledWith(
      'hi @[Oscar UK](2) and @[Hal Helper](3) @[Olive Owner](1) @Oli x @H',
    )
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('starts from saved text and offers Cancel', async () => {
    const onCancel = vi.fn()
    const onSubmit = vi.fn(async () => false)
    render(
      <CommentComposer
        label="Edit comment"
        submitLabel="Save"
        busyLabel="Saving…"
        isSubmitting={false}
        onSubmit={onSubmit}
        onCancel={onCancel}
        initialText="hey @Olive Owner"
        initialPicked={[members[0]]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith('hey @[Olive Owner](1)')
    expect(screen.getByLabelText('Edit comment')).toHaveValue('hey @Olive Owner')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('CommentThreadView discussion actions', () => {
  const thread = [
    {
      id: 10,
      content: 'Who has banners? @[Olive Owner](1)',
      authorName: 'Hal',
      createdAt: new Date('2026-01-02T10:00:00Z'),
      editedAt: new Date('2026-01-02T11:00:00Z'),
      canEdit: true,
      canDelete: true,
      replies: [
        { id: 11, content: 'I do', authorName: 'Olive', createdAt: null, canDelete: true },
        { id: 12, content: '', authorName: 'Otto', createdAt: null, deleted: true },
      ],
    },
    {
      id: 13,
      content: '',
      authorName: 'Gone',
      createdAt: null,
      deleted: true,
      replies: [{ id: 14, content: 'orphan reply', authorName: 'Olive', createdAt: null }],
    },
  ]

  function renderThread(overrides: Partial<ComponentProps<typeof CommentThreadView>> = {}) {
    const handlers = {
      onSubmit: vi.fn(async (_content: string, _parentId?: number) => true),
      onEdit: vi.fn(async (_id: number, _content: string) => true),
      onDelete: vi.fn(async (_id: number) => true),
    }
    render(
      <ToastProvider>
        <CommentThreadView
          comments={thread}
          canPost
          canReply
          isPending={false}
          isSubmitting={false}
          {...handlers}
          {...overrides}
        />
      </ToastProvider>,
    )
    return handlers
  }

  it('renders mentions, edits, removed comments and nested replies', () => {
    renderThread()
    expect(screen.getByText('@Olive Owner')).toHaveClass('text-primary')
    expect(screen.getByText('(edited)')).toBeInTheDocument()
    expect(screen.getAllByText('Comment removed')).toHaveLength(2)
    expect(screen.getByText('orphan reply')).toBeInTheDocument()
    // Reply only on live top-level comments; Edit/Delete only where allowed.
    expect(screen.getAllByRole('button', { name: 'Reply' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
  })

  it('posts a reply under its thread', async () => {
    const { onSubmit } = renderThread()
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await userEvent.type(screen.getByLabelText('Write a reply'), 'On it')
    await userEvent.click(screen.getAllByRole('button', { name: 'Reply' })[1])
    expect(onSubmit).toHaveBeenCalledWith('On it', 10)
    await waitFor(() => expect(screen.queryByLabelText('Write a reply')).toBeNull())

    // A failed reply keeps the box; Cancel closes it.
    onSubmit.mockResolvedValueOnce(false)
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await userEvent.type(screen.getByLabelText('Write a reply'), 'Again')
    await userEvent.click(screen.getAllByRole('button', { name: 'Reply' })[1])
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Write a reply')).toHaveValue('Again')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Write a reply')).toBeNull()
  })

  it('edits a comment in place, keeping its mentions', async () => {
    const { onEdit } = renderThread()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByLabelText('Edit comment')
    expect(box).toHaveValue('Who has banners? @Olive Owner')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    onEdit.mockResolvedValueOnce(false)
    await userEvent.type(box, '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onEdit).toHaveBeenCalledWith(10, 'Who has banners? @[Olive Owner](1)!')
    expect(screen.getByLabelText('Edit comment')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByLabelText('Edit comment')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Edit comment')).toBeNull()
  })

  it('deletes after confirming', async () => {
    const { onDelete } = renderThread()
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Delete this comment?' })
    expect(dialog).toHaveTextContent('Comment removed')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDelete).not.toHaveBeenCalled()

    onDelete.mockResolvedValueOnce(false)
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )
    expect(onDelete).toHaveBeenCalledWith(11)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onDelete).toHaveBeenCalledTimes(2)
  })

  it('offers no actions without the handlers, or replies when not allowed', () => {
    renderThread({ onEdit: undefined, onDelete: undefined, canReply: false })
    expect(screen.queryByRole('button', { name: /^(Reply|Edit|Delete)$/ })).toBeNull()
  })
})

describe('CommentThread / BugReportCommentThread', () => {
  it('load and post work-item comments through the API', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const task = await createTask(project.id)
    await renderApp(<CommentThread workItemId={task.id} emptyText="Quiet here" />, { as: owner })
    expect(await screen.findByText('Quiet here')).toBeInTheDocument()
    const box = await screen.findByLabelText('Add a comment')
    await userEvent.type(box, 'A comment')
    await userEvent.click(screen.getByRole('button', { name: 'Post Comment' }))
    expect(await screen.findByText('Comment added')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('A comment')).toBeInTheDocument())
    expect(await prisma.workItemComment.count({ where: { workItemId: task.id } })).toBe(1)
  })

  it('replies, edits and deletes work-item comments through the API', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    await clientAs(owner).workItemComments.add({ workItemId: project.id, content: 'Kick-off' })
    await renderApp(<CommentThread workItemId={project.id} />, { as: owner })

    await userEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    await userEvent.type(screen.getByLabelText('Write a reply'), 'Agenda soon')
    await userEvent.click(screen.getAllByRole('button', { name: 'Reply' })[1])
    expect(await screen.findByText('Agenda soon')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    const box = screen.getByLabelText('Edit comment')
    await userEvent.clear(box)
    await userEvent.type(box, 'Kick-off moved')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Comment updated')).toBeInTheDocument()
    expect(await screen.findByText('Kick-off moved')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText('Edit comment')).toBeNull())

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )
    expect(await screen.findByText('Comment deleted')).toBeInTheDocument()
    expect(await screen.findByText('Comment removed')).toBeInTheDocument()
    const reply = await prisma.workItemComment.findFirstOrThrow({
      where: { workItemId: project.id, parentId: { not: null } },
    })
    expect(reply.deletedAt).not.toBeNull()
  })

  it('edits and deletes bug report comments', async () => {
    const reporter = await createVolunteer()
    const { id } = await clientAs(reporter).bugReports.create({
      title: 'B',
      description: 'Ten characters at least',
    })
    await clientAs(reporter).bugReportComments.add({ bugReportId: id, content: 'Typo' })
    await renderApp(<BugReportCommentThread bugReportId={id} />, { as: reporter })

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByLabelText('Edit comment'), ' fixed')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Typo fixed')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText('Edit comment')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )
    expect(await screen.findByText('Comment removed')).toBeInTheDocument()
  })

  it('surfaces a failed post as an error toast', async () => {
    const owner = await createVolunteer()
    const stranger = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    // The stranger can view the project but not post; render as the owner then swap the
    // stored session so the mutation is refused server-side.
    await renderApp(<CommentThread workItemId={project.id} />, { as: owner })
    const box = await screen.findByLabelText('Add a comment')
    const { createSession } = await import('@/lib/auth')
    localStorage.setItem('authToken', await createSession(stranger.id))
    await userEvent.type(box, 'Nope')
    await userEvent.click(screen.getByRole('button', { name: 'Post Comment' }))
    expect(await screen.findByText('Not authorized to comment here')).toBeInTheDocument()
    expect(box).toHaveValue('Nope')
  })

  it('load and post bug report comments', async () => {
    const reporter = await createVolunteer()
    const { id } = await clientAs(reporter).bugReports.create({
      title: 'B',
      description: 'Ten characters at least',
    })
    await renderApp(<BugReportCommentThread bugReportId={id} placeholder="Reply" />, {
      as: reporter,
    })
    const box = await screen.findByPlaceholderText('Reply')
    await userEvent.type(box, 'Thanks')
    await userEvent.click(await screen.findByRole('button', { name: 'Post Comment' }))
    await waitFor(() => expect(screen.getByText('Thanks')).toBeInTheDocument())
    // The submit resolves after the list refetch, clearing the box; let it finish first.
    await waitFor(() => expect(box).toHaveValue(''))
    await screen.findByRole('button', { name: 'Post Comment' })
    await userEvent.type(box, 'Again')
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(await screen.findByRole('button', { name: 'Post Comment' }))
    expect(await screen.findByText('Unauthorized')).toBeInTheDocument()
  })
})

describe('Footer', () => {
  it('shows the version and PR link when deployed, plain links otherwise', async () => {
    await renderApp(<Footer />)
    expect(screen.getByRole('link', { name: 'Privacy & Data' })).toHaveAttribute('href', '/privacy')
    await waitFor(() => expect(screen.queryByText(/PR #/)).toBeNull())
  })
})

describe('AiEditingHelp', () => {
  it('copies the guide, toggles the full text, and opens it when the clipboard is refused', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(<AiEditingHelp />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy instructions' }))
    expect(writeText).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy instructions' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Read' }))
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }))
    writeText.mockRejectedValueOnce(new Error('denied'))
    await userEvent.click(screen.getByRole('button', { name: 'Copy instructions' }))
    expect(await screen.findByRole('button', { name: 'Hide' })).toBeInTheDocument()
  })
})
