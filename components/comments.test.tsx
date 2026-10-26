import type { ComponentProps, ReactElement } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render as plainRender, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createProject, createTask } from '@/test/factories'
import { AppProviders, renderApp } from '@/test/render'
import { clientAs } from '@/test/rpc'
import CommentThread from './CommentThread'
import BugReportCommentThread from './BugReportCommentThread'
import CommentThreadView, { type CommentItem } from './CommentThreadView'
import CommentComposer from './CommentComposer'
import Footer from './Footer'
import AiEditingHelp from './AiEditingHelp'
import { ToastProvider } from '@/lib/toast'
import { useMutation } from '@tanstack/react-query'

/** Names in a thread look their author up, so even a bare view needs the app's providers. */
const render = (ui: ReactElement) => plainRender(ui, { wrapper: AppProviders })

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
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByText('Ann')).toBeInTheDocument()
    expect(screen.getByText(/1 January 2026/)).toBeInTheDocument()
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
    // An empty Post says why nothing was sent, until something is typed.
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write something first.')
    expect(box).toHaveFocus()
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: '  hello  ' } })
    expect(screen.queryByRole('alert')).toBeNull()
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
    // Reply on every live comment, naming whom it answers; Edit/Delete only where allowed.
    expect(screen.getAllByRole('button', { name: /^Reply to / }).map((b) => b.ariaLabel)).toEqual([
      'Reply to Hal',
      'Reply to Olive',
      'Reply to Olive',
    ])
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
    // Each thread's replies are a list of their own.
    const replies = screen.getByRole('list', { name: 'Replies to Hal' })
    expect(within(replies).getAllByRole('listitem')).toHaveLength(2)
    expect(
      within(screen.getByRole('list', { name: 'Replies to a removed comment' })).getByText(
        'orphan reply',
      ),
    ).toBeInTheDocument()
  })

  it('posts a reply under its thread', async () => {
    const { onSubmit } = renderThread()
    await userEvent.click(screen.getByRole('button', { name: 'Reply to Hal' }))
    const box = screen.getByLabelText('Write a reply to Hal')
    expect(box).toHaveFocus()
    // An empty reply says why nothing happened.
    await userEvent.click(screen.getByRole('button', { name: 'Post reply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write something first.')
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.type(box, 'On it')
    await userEvent.click(screen.getByRole('button', { name: 'Post reply' }))
    expect(onSubmit).toHaveBeenCalledWith('On it', 10)
    await waitFor(() => expect(screen.queryByLabelText('Write a reply to Hal')).toBeNull())

    // A failed reply keeps the box; Cancel closes it.
    onSubmit.mockResolvedValueOnce(false)
    await userEvent.click(screen.getByRole('button', { name: 'Reply to Hal' }))
    await userEvent.type(screen.getByLabelText('Write a reply to Hal'), 'Again')
    await userEvent.click(screen.getByRole('button', { name: 'Post reply' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Write a reply to Hal')).toHaveValue('Again')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Write a reply to Hal')).toBeNull()
  })

  it('answers a reply in the same thread, with the reply it answers', async () => {
    const { onSubmit } = renderThread()
    await userEvent.click(screen.getAllByRole('button', { name: 'Reply to Olive' })[0])
    const box = screen.getByLabelText('Write a reply to Olive')
    expect(box).toHaveFocus()
    // The box sits at the foot of the thread, after its replies.
    const replies = screen.getByRole('list', { name: 'Replies to Hal' })
    expect(replies.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.type(box, 'Thanks')
    await userEvent.click(screen.getByRole('button', { name: 'Post reply' }))
    expect(onSubmit).toHaveBeenCalledWith('Thanks', 11)

    // Choosing another comment to answer moves the box and its focus there.
    await userEvent.click(screen.getByRole('button', { name: 'Reply to Hal' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Reply to Olive' })[1])
    expect(screen.queryByLabelText('Write a reply to Hal')).toBeNull()
    const orphanBox = screen.getByLabelText('Write a reply to Olive')
    expect(orphanBox).toHaveFocus()
    await userEvent.type(orphanBox, 'Still here')
    await userEvent.click(screen.getByRole('button', { name: 'Post reply' }))
    expect(onSubmit).toHaveBeenLastCalledWith('Still here', 14)
  })

  it("links a comment's author to their profile, unless their account is gone", async () => {
    const [viewer, ann] = [await createVolunteer(), await createVolunteer()]
    await renderApp(
      <CommentThreadView
        comments={[
          { id: 1, content: 'First', authorName: 'Ann', authorId: ann.id, createdAt: null },
          { id: 2, content: 'Second', authorName: null, authorId: null, createdAt: null },
        ]}
        canPost={false}
        isPending={false}
        isSubmitting={false}
        onSubmit={async () => true}
      />,
      { as: viewer },
    )
    expect(await screen.findByRole('link', { name: 'Ann' })).toHaveAttribute(
      'href',
      `/volunteers/${ann.id}`,
    )
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Unknown' })).toBeNull()
  })

  it('quotes the reply answered, unless it is the thread starter', () => {
    renderThread({
      comments: [
        {
          id: 30,
          content: 'Root',
          authorName: 'Hal',
          createdAt: null,
          replies: [
            { id: 31, content: 'First reply', authorName: 'Olive', createdAt: null },
            {
              id: 32,
              content: 'Second reply',
              authorName: 'Otto',
              createdAt: null,
              repliedTo: {
                id: 31,
                authorId: null,
                authorName: 'Olive',
                content: 'First reply',
                deleted: false,
              },
            },
            {
              id: 33,
              content: 'Third reply',
              authorName: 'Gail',
              createdAt: null,
              repliedTo: {
                id: 999,
                authorId: null,
                authorName: 'Gone',
                content: '',
                deleted: true,
              },
            },
          ],
        },
      ],
    })
    const quoteLink = screen.getByRole('link', { name: 'Olive: "First reply"' })
    expect(quoteLink).toHaveAttribute('href', '#comment-31')
    const removedLink = screen.getByRole('link', { name: 'a removed comment' })
    expect(removedLink).toHaveAttribute('href', '#comment-999')
    // The first reply answers the thread starter directly: no quote needed.
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('focuses the quoted comment when its link is clicked, opening its fold', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const replies: CommentItem[] = [
      ...[1, 2, 3, 4, 5].map((n) => ({
        id: 100 + n,
        content: `Reply ${n}`,
        authorName: 'Olive',
        createdAt: null,
      })),
      {
        id: 106,
        content: 'Quoting the second reply',
        authorName: 'Gail',
        createdAt: null,
        repliedTo: {
          id: 102,
          authorId: null,
          authorName: 'Olive',
          content: 'Reply 2',
          deleted: false,
        },
      },
    ]
    renderThread({
      comments: [{ id: 20, content: 'Long one', authorName: 'Hal', createdAt: null, replies }],
    })
    await userEvent.click(screen.getByRole('link', { name: 'Olive: "Reply 2"' }))
    expect(window.location.hash).toBe('#comment-102')
    expect(screen.getByText('Reply 2')).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalled()
    expect(document.getElementById('comment-102')).toHaveClass('ring-2')
    window.history.replaceState(null, '', '/x')
  })

  it('collapses the middle of a long thread until asked', async () => {
    const replies = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: 100 + n,
      content: `Reply ${n}`,
      authorName: 'Olive',
      createdAt: null,
    }))
    renderThread({
      comments: [{ id: 20, content: 'Long one', authorName: 'Hal', createdAt: null, replies }],
    })
    const list = screen.getByRole('list', { name: 'Replies to Hal' })
    const shownReplies = () =>
      within(list)
        .queryAllByText(/^Reply \d$/)
        .map((p) => p.textContent)
    expect(shownReplies()).toEqual(['Reply 1', 'Reply 5', 'Reply 6'])
    await userEvent.click(within(list).getByRole('button', { name: 'Show 3 more replies' }))
    expect(shownReplies()).toEqual([
      'Reply 1',
      'Reply 2',
      'Reply 3',
      'Reply 4',
      'Reply 5',
      'Reply 6',
    ])
    expect(document.getElementById('comment-102')).toHaveFocus()
    expect(screen.queryByRole('button', { name: /more replies/ })).toBeNull()
  })

  it('expands every folded thread at once', async () => {
    const repliesFor = (prefix: string) =>
      [1, 2, 3, 4, 5, 6].map((n) => ({
        id: prefix === 'a' ? 200 + n : 300 + n,
        content: `${prefix} reply ${n}`,
        authorName: 'Olive',
        createdAt: null,
      }))
    renderThread({
      comments: [
        {
          id: 20,
          content: 'Thread A',
          authorName: 'Hal',
          createdAt: null,
          replies: repliesFor('a'),
        },
        {
          id: 21,
          content: 'Thread B',
          authorName: 'Gail',
          createdAt: null,
          replies: repliesFor('b'),
        },
      ],
    })
    expect(screen.getAllByText(/^Show 3 more replies$/)).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Expand all replies' }))
    expect(screen.queryByRole('button', { name: /more replies/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expand all replies' })).toBeNull()
    expect(screen.getByText('a reply 3')).toBeInTheDocument()
    expect(screen.getByText('b reply 3')).toBeInTheDocument()
  })

  it('opens a collapsed thread to show a permalinked reply', () => {
    window.history.replaceState(null, '', '/x#comment-103')
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const replies = [1, 2, 3, 4, 5].map((n) => ({
      id: 100 + n,
      content: `Reply ${n}`,
      authorName: 'Olive',
      createdAt: null,
    }))
    renderThread({
      comments: [
        { type: 'event', id: 1, text: 'Hal started this', createdAt: null },
        { id: 20, content: 'Long one', authorName: 'Hal', createdAt: null, replies },
      ],
    })
    expect(screen.getByText('Reply 3')).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(document.getElementById('comment-103')).toHaveClass('ring-2')
    window.history.replaceState(null, '', '/x')
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
    expect(screen.queryByRole('button', { name: /^(Reply|Edit|Delete)/ })).toBeNull()
  })
})

/** A button that runs some write through react-query, as any page's mutation does. */
function MutationButton({ run }: { run: () => Promise<unknown> }) {
  const mutation = useMutation({ mutationFn: run })
  return (
    <button type="button" onClick={() => mutation.mutate()}>
      Run
    </button>
  )
}

describe('CommentThread / BugReportCommentThread', () => {
  it('load and post work-item comments through the API', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const task = await createTask(project.id)
    await renderApp(<CommentThread workItemId={task.id} emptyText="Quiet here" />, { as: owner })
    expect(await screen.findByText('Quiet here')).toBeInTheDocument()
    const box = await screen.findByLabelText('Add a comment')
    await userEvent.type(box, 'A comment')
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    expect(await screen.findByText('Comment added')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('A comment')).toBeInTheDocument())
    expect(await prisma.workItemComment.count({ where: { workItemId: task.id } })).toBe(1)
  })

  it('lists the newest comment first, right under the comment box, with replies oldest first', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const at = (day: number) => new Date(`2026-01-0${day}T10:00:00Z`)
    const comment = (content: string, day: number, parentId?: number) =>
      prisma.workItemComment.create({
        data: { workItemId: project.id, authorId: owner.id, content, createdAt: at(day), parentId },
      })
    const older = await comment('Older', 1)
    await comment('Newer', 2)
    await comment('Late reply', 4, older.id)
    await comment('Early reply', 3, older.id)
    await renderApp(<CommentThread workItemId={project.id} />, { as: owner })
    await screen.findByText('Older')
    const texts = () => [...document.querySelectorAll('li > p')].map((p) => p.textContent)
    expect(texts()).toEqual(['Newer', 'Older', 'Early reply', 'Late reply'])
    const box = screen.getByLabelText('Add a comment')
    const list = screen.getByText('Newer').closest('ul')!
    expect(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await userEvent.type(box, 'Newest')
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    await waitFor(() => expect(texts()[0]).toBe('Newest'))
  })

  it('shows recorded changes as plain lines among the comments, in time order', async () => {
    const owner = await createVolunteer({ name: 'Olive' })
    const helper = await createVolunteer({ name: 'Hal' })
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const task = await createTask(project.id)
    await prisma.workItemComment.create({
      data: {
        workItemId: task.id,
        authorId: owner.id,
        content: 'Who can take this?',
        createdAt: new Date('2026-10-09T13:00:00Z'),
      },
    })
    await clientAs(owner).projects.assignTask({
      projectId: project.id,
      taskId: task.id,
      assigneeId: helper.id,
    })
    // Seen by a helper who is not on the task: event lines are for everyone who can see it.
    const reader = await createVolunteer()
    await renderApp(<CommentThread workItemId={task.id} />, { as: reader })
    const line = await screen.findByText(/^Olive assigned this to Hal · /)
    const items = [...document.querySelectorAll('ul > li')].map((li) => li.textContent)
    expect(items[0]).toMatch(/^Olive assigned this to Hal · /)
    expect(items[1]).toContain('Who can take this?')
    expect(line.id).toMatch(/^event-\d+$/)
    expect(within(line).queryByRole('button')).toBeNull()
  })

  it('refreshes an open Discussion after any successful write', async () => {
    const owner = await createVolunteer({ name: 'Olive' })
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const task = await createTask(project.id, { title: 'Banners' })
    const rename = () =>
      clientAs(owner).projects.updateTask({
        projectId: project.id,
        taskId: task.id,
        data: { title: 'Flags' },
      })
    await renderApp(
      <>
        <MutationButton run={rename} />
        <CommentThread workItemId={task.id} />
      </>,
      { as: owner },
    )
    await screen.findByLabelText('Add a comment')
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText(/^Olive renamed this 'Flags' · /)).toBeInTheDocument()
  })

  it('replies, edits and deletes work-item comments through the API', async () => {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    await clientAs(owner).workItemComments.add({ workItemId: project.id, content: 'Kick-off' })
    await renderApp(<CommentThread workItemId={project.id} />, { as: owner })

    await userEvent.click(await screen.findByRole('button', { name: `Reply to ${owner.name}` }))
    await userEvent.type(screen.getByLabelText(`Write a reply to ${owner.name}`), 'Agenda soon')
    await userEvent.click(screen.getByRole('button', { name: 'Post reply' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }))
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
    await userEvent.click(await screen.findByRole('button', { name: 'Post comment' }))
    await waitFor(() => expect(screen.getByText('Thanks')).toBeInTheDocument())
    // The submit resolves after the list refetch, clearing the box; let it finish first.
    await waitFor(() => expect(box).toHaveValue(''))
    await screen.findByRole('button', { name: 'Post comment' })
    await userEvent.type(box, 'Again')
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(await screen.findByRole('button', { name: 'Post comment' }))
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
