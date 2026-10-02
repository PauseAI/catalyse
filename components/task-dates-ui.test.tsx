import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DatesBlock from './DatesBlock'
import TaskDatesSummary from './TaskDatesSummary'
import { EMPTY_DATES, type DatesValue } from '@/lib/task-dates'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/** A Dates block that owns its value, the way a form does, and shows it for assertions. */
function Harness(
  props: Omit<Parameters<typeof DatesBlock>[0], 'id' | 'value' | 'onChange'> & {
    initial?: Partial<DatesValue>
  },
) {
  const { initial, ...rest } = props
  const [value, setValue] = useState<DatesValue>({ ...EMPTY_DATES, ...initial })
  return (
    <form>
      <DatesBlock id="t" value={value} onChange={setValue} {...rest} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </form>
  )
}

const value = () => JSON.parse(screen.getByTestId('value').textContent!) as DatesValue

describe('DatesBlock', () => {
  it('keeps start, end and days in step and relates the end to the deadline', async () => {
    render(<Harness initial={{ deadline: '2030-09-17' }} />)
    expect(screen.getByText(/No start date: it goes at the beginning of the plan/)).toBeTruthy()
    expect(screen.queryByLabelText('To')).toBeNull()

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2030-09-14' } })
    expect(screen.getByLabelText('To')).toHaveValue('2030-09-14')
    expect(screen.getByText('Starts on this date.')).toBeTruthy()
    expect(screen.getByText('Planned to finish 14 Sept 2030, 3 days before the deadline.'))

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2030-09-20' } })
    expect(value().durationDays).toBe('7')
    const late = screen.getByText('Planned to finish 20 Sept 2030, 3 days after the deadline.')
    expect(late).toHaveClass('text-error')

    // Moving the start keeps the length and moves the end.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2030-09-15' } })
    expect(screen.getByLabelText('To')).toHaveValue('2030-09-21')

    fireEvent.change(screen.getByLabelText('Days'), { target: { value: '2' } })
    expect(screen.getByLabelText('To')).toHaveValue('2030-09-16')

    // One click makes the window end on the deadline.
    await userEvent.click(screen.getByRole('button', { name: 'Fit to deadline' }))
    expect(value().durationDays).toBe('3')
    expect(screen.getByText('Planned to finish 17 Sept 2030, on the deadline.'))
    expect(screen.queryByRole('button', { name: 'Fit to deadline' })).toBeNull()

    await userEvent.type(screen.getByLabelText('Effort (hours of work)'), '6')
    expect(value().estimatedHours).toBe('6')
    fireEvent.change(screen.getByLabelText('Deadline (optional)'), { target: { value: '' } })
    expect(screen.queryByText(/Planned to finish/)).toBeNull()
  })

  it('says when the deadline has gone by, and stops offering to fit the window to it', () => {
    render(
      <Harness initial={{ startDate: '2026-09-14', durationDays: '1', deadline: '2026-09-17' }} />,
    )
    expect(
      screen.getByText(/^Planned to finish 14 Sept 2026; the deadline passed \d+ days ago\.$/),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Fit to deadline' })).toBeNull()
  })

  it('refuses an end before the start until it is fixed', () => {
    render(<Harness initial={{ startDate: '2026-09-14', durationDays: '3' }} />)
    const end = screen.getByLabelText('To') as HTMLInputElement
    fireEvent.change(end, { target: { value: '2026-09-10' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Ends before it starts')
    expect(end).toHaveAttribute('aria-invalid', 'true')
    expect(end.validationMessage).toBe('Ends before it starts')
    expect(value().durationDays).toBe('3')
    // Clearing the end is not an error either; it changes nothing.
    fireEvent.change(end, { target: { value: '' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(end, { target: { value: '2026-09-15' } })
    expect(value().durationDays).toBe('2')
    expect(end.validationMessage).toBe('')
  })

  it('offers set dates and a milestone, with no deadline', async () => {
    render(
      <Harness initial={{ startDate: '2026-09-26', durationDays: '1', deadline: '2026-09-30' }} />,
    )
    await userEvent.click(screen.getByRole('radio', { name: /On set dates/ }))
    expect(screen.getByLabelText('Runs from')).toBeTruthy()
    expect(screen.queryByLabelText('Deadline (optional)')).toBeNull()
    // The deadline it had is named, so switching is not a silent loss.
    expect(
      screen.getByText(
        'No deadline: the dates themselves are fixed. Saving removes the deadline of 30 Sept 2026.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/Planned to finish/)).toBeNull()

    const moment = screen.getByRole('checkbox', { name: /a moment, not a stretch of work/ })
    await userEvent.click(moment)
    expect(value().durationDays).toBe('0')
    expect(screen.queryByLabelText('To')).toBeNull()
    expect(screen.queryByLabelText('Days')).toBeNull()
    await userEvent.click(moment)
    expect(value().durationDays).toBe('1')

    // Back to a window, a milestone's zero days would make no sense, so it is cleared.
    await userEvent.click(moment)
    await userEvent.click(screen.getByRole('radio', { name: /Any time in a window/ }))
    expect(value()).toMatchObject({ timing: 'flexible', durationDays: '' })
    await userEvent.click(screen.getByRole('radio', { name: /On set dates/ }))
    await userEvent.click(screen.getByRole('radio', { name: /Any time in a window/ }))
    expect(value().durationDays).toBe('')
  })

  it('explains a task that follows another, and shows the note', () => {
    const { unmount } = render(
      <Harness
        initial={{ durationDays: '3' }}
        followsTitle="Book the venue"
        derivedStart={day('2026-09-15')}
        note="Only the project owner can change these dates once the task exists."
      />,
    )
    expect(
      screen.getByText(
        'Starts when “Book the venue” finishes (currently 15 Sept 2026 – 17 Sept 2026).',
      ),
    ).toBeTruthy()
    expect(screen.getByText(/Only the project owner can change these dates/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-14' } })
    expect(screen.getByText(/Starts on this date even if “Book the venue” runs late/)).toBeTruthy()
    unmount()
    render(<Harness followsTitle="Book the venue" />)
    expect(screen.getByText('Starts when “Book the venue” finishes.')).toBeTruthy()
  })
})

describe('TaskDatesSummary', () => {
  const base = {
    timing: 'flexible' as const,
    durationDays: 7,
    estimatedHours: 6,
    deadline: day('2099-09-17'),
    placement: { start: day('2099-09-14'), end: day('2099-09-20'), daysLate: 3 },
    assigneeName: 'Chelsie',
    startedAt: day('2099-09-14'),
    completedAt: null,
    hasPosted: false,
  }
  const dd = (label: string) => screen.getByText(label).nextSibling

  it('reads a flexible window against its deadline', () => {
    render(<TaskDatesSummary {...base} />)
    expect(dd('When')).toHaveTextContent(
      '14 Sept 2099 – 20 Sept 2099Any time in this window, about 6 hours of work',
    )
    expect(dd('Deadline')).toHaveTextContent('17 Sept 2099 · 3 days late')
    expect(dd('Who')).toHaveTextContent('Chelsie, claimed on 14 Sept 2099')
  })

  it('calls a passed deadline on unfinished work overdue, whatever the plan says', () => {
    render(
      <TaskDatesSummary
        {...base}
        deadline={day('2020-01-02')}
        placement={{ start: day('2020-01-01'), end: day('2020-01-01'), daysLate: -1 }}
      />,
    )
    expect(dd('Deadline')).toHaveTextContent(/^2 Jan 2020 · \d+ days overdue$/)
  })

  it('reads set dates, a milestone and a task off the timeline', () => {
    const { rerender } = render(
      <TaskDatesSummary {...base} timing="fixed" durationDays={0} hasPosted />,
    )
    expect(dd('When')).toHaveTextContent('A moment, not a stretch of work')
    expect(screen.queryByText('Deadline')).toBeNull()
    expect(dd('Who')).toHaveTextContent('Chelsie, started 14 Sept 2099')

    rerender(
      <TaskDatesSummary
        {...base}
        placement={null}
        deadline={null}
        assigneeName="Chelsie"
        startedAt={null}
      />,
    )
    expect(dd('When')).toHaveTextContent('Not on the timeline yetAbout 6 hours of work')
    expect(dd('Who')).toHaveTextContent('Chelsie')

    rerender(
      <TaskDatesSummary
        {...base}
        placement={null}
        estimatedHours={null}
        assigneeName="Chelsie"
        completedAt={day('2099-09-21')}
      />,
    )
    expect(dd('When')).toHaveTextContent(/^Not on the timeline yet$/)
    expect(dd('Deadline')).toHaveTextContent(/^17 Sept 2099$/)
    expect(dd('Who')).toHaveTextContent('Chelsie, finished 21 Sept 2099')
  })
})
