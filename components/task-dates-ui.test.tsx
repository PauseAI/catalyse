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
  it('takes an optional start and one deadline, and refuses a deadline before the start', async () => {
    render(<Harness />)
    expect(screen.getByText(/No start date: it goes at the beginning of the plan/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '2030-09-17' } })
    expect(value().deadline).toBe('2030-09-17')
    expect(screen.getByText('No start date: any time up to the deadline.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Start (optional)'), {
      target: { value: '2030-09-20' },
    })
    expect(screen.getByText('Starts on this date.')).toBeTruthy()
    const deadline = screen.getByLabelText('Deadline') as HTMLInputElement
    expect(deadline).toHaveAttribute('min', '2030-09-20')
    expect(screen.getByRole('alert')).toHaveTextContent('The deadline is before the start')
    expect(deadline).toHaveAttribute('aria-invalid', 'true')
    expect(deadline.validationMessage).toBe('The deadline is before the start')

    fireEvent.change(screen.getByLabelText('Start (optional)'), {
      target: { value: '2030-09-14' },
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(deadline.validationMessage).toBe('')

    await userEvent.type(screen.getByLabelText('Effort (hours of work)'), '6')
    expect(value().estimatedHours).toBe('6')
  })

  it('offers set dates and a milestone', async () => {
    render(<Harness initial={{ startDate: '2026-09-26', deadline: '2026-09-30' }} />)
    await userEvent.click(screen.getByRole('radio', { name: /On set dates/ }))
    expect(screen.getByLabelText('Runs from')).toBeTruthy()
    expect(screen.getByLabelText('To')).toHaveValue('2026-09-30')
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-25' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Ends before it starts')
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } })

    const moment = screen.getByRole('checkbox', { name: /a moment, not a stretch of work/ })
    await userEvent.click(moment)
    expect(value().milestone).toBe(true)
    expect(screen.getByLabelText('On')).toBeTruthy()
    expect(screen.queryByLabelText('To')).toBeNull()
    await userEvent.click(moment)
    expect(value().milestone).toBe(false)

    // Back to a window, a milestone makes no sense, so it is cleared.
    await userEvent.click(moment)
    await userEvent.click(screen.getByRole('radio', { name: /Any time in a window/ }))
    expect(value()).toMatchObject({ timing: 'flexible', milestone: false })
  })

  it('explains a task that follows another, warns when it cannot make its deadline, and shows the note', () => {
    const { unmount } = render(
      <Harness
        initial={{ deadline: '2026-09-13' }}
        followsTitle="Book the venue"
        derivedStart={day('2026-09-15')}
        note="Only the project owner can change these dates once the task exists."
      />,
    )
    expect(
      screen.getByText('Starts when “Book the venue” finishes (currently 15 Sept 2026).'),
    ).toBeTruthy()
    expect(
      screen.getByText(
        '“Book the venue” finishes too late: this can’t start until 15 Sept 2026, 2 days after its deadline.',
      ),
    ).toHaveClass('text-error')
    expect(screen.getByText(/Only the project owner can change these dates/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Start (optional)'), {
      target: { value: '2026-09-10' },
    })
    expect(screen.getByText(/Starts on this date even if “Book the venue” runs late/)).toBeTruthy()
    expect(screen.queryByText(/finishes too late/)).toBeNull()
    unmount()
    render(<Harness followsTitle="Book the venue" />)
    expect(screen.getByText('Starts when “Book the venue” finishes.')).toBeTruthy()
  })
})

describe('TaskDatesSummary', () => {
  const base = {
    timing: 'flexible' as const,
    durationDays: null,
    estimatedHours: 6,
    deadline: day('2099-09-20'),
    openStart: false,
    placement: { start: day('2099-09-14'), end: day('2099-09-20'), daysLate: null },
    assigneeName: 'Chelsie',
    startedAt: day('2099-09-14'),
    completedAt: null,
    hasPosted: false,
  }
  const dd = (label: string) => screen.getByText(label).nextSibling

  it('reads a flexible window that ends on its deadline', () => {
    render(<TaskDatesSummary {...base} />)
    expect(dd('When')).toHaveTextContent(
      /^14 Sept 2099 – 20 Sept 2099Any time in this window, about 6 hours of work$/,
    )
    expect(screen.queryByText('Deadline')).toBeNull()
    expect(dd('Who')).toHaveTextContent('Chelsie, claimed on 14 Sept 2099')
  })

  it('reads only the deadline when nothing sets a start', () => {
    const { rerender } = render(<TaskDatesSummary {...base} openStart />)
    expect(dd('When')).toHaveTextContent(/^By 20 Sept 2099About 6 hours of work$/)
    rerender(<TaskDatesSummary {...base} openStart estimatedHours={null} />)
    expect(dd('When')).toHaveTextContent(/^By 20 Sept 2099$/)
  })

  it('says when it is late: overdue once the deadline passes, or pushed past it by the work before', () => {
    const { rerender } = render(
      <TaskDatesSummary
        {...base}
        deadline={day('2020-01-02')}
        placement={{ start: day('2020-01-01'), end: day('2020-01-02'), daysLate: null }}
      />,
    )
    expect(dd('When')).toHaveTextContent(/\d+ days overdue$/)
    rerender(
      <TaskDatesSummary
        {...base}
        placement={{ start: day('2099-09-23'), end: day('2099-09-23'), daysLate: 3 }}
      />,
    )
    expect(dd('When')).toHaveTextContent(/3 days late$/)
  })

  it('reads set dates, a milestone and a task off the timeline', () => {
    const { rerender } = render(
      <TaskDatesSummary {...base} timing="fixed" durationDays={0} deadline={null} hasPosted />,
    )
    expect(dd('When')).toHaveTextContent('A moment, not a stretch of work')
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
    expect(dd('Who')).toHaveTextContent('Chelsie, finished 21 Sept 2099')
  })
})
