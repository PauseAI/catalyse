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

    await userEvent.type(screen.getByLabelText('Effort: about'), '6')
    expect(value().estimatedHours).toBe('6')
  })

  it('shows only a start, a deadline, the effort and one tick for exact dates', async () => {
    render(<Harness initial={{ startDate: '2026-09-26', deadline: '2026-09-30' }} />)
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.queryByText(/milestone|lag/i)).toBeNull()

    const exact = screen.getByRole('checkbox', {
      name: 'Happens on these exact dates (a shift or event)',
    })
    await userEvent.click(exact)
    expect(value()).toMatchObject({ timing: 'fixed', deadline: '2026-09-30' })
    expect(screen.getByLabelText('Start (optional)')).toHaveValue('2026-09-26')
    await userEvent.click(exact)
    expect(value().timing).toBe('flexible')
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
      screen.getByText('Starts when “Book the venue” is done (currently 15 Sept 2026).'),
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
    expect(
      screen.getByText(
        'Starts on this date even if “Book the venue” runs late. Clear it to start when “Book the venue” is done.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/follow/i)).toBeNull()
    expect(screen.queryByText(/finishes too late/)).toBeNull()
    unmount()
    render(<Harness followsTitle="Book the venue" />)
    expect(screen.getByText('Starts when “Book the venue” is done.')).toBeTruthy()
  })
})

describe('TaskDatesSummary', () => {
  const today = day('2099-09-17')
  const base = {
    estimatedHours: 6,
    deadline: day('2099-09-20'),
    openStart: false,
    placement: { start: day('2099-09-14'), end: day('2099-09-20'), daysLate: null },
    handedIn: false,
    today,
  }
  const summary = () => screen.getByRole('group', { name: 'When it is due' })

  it('reads Due, how far away, the start of its window, and the effort', () => {
    const { rerender } = render(<TaskDatesSummary {...base} />)
    expect(summary()).toHaveTextContent(
      /^Due 20 Sept · in 3 days \(from 14 Sept\)Effort: about 6 hours$/,
    )
    expect(screen.queryByText(/When|Who|Takes the/)).toBeNull()

    // Nothing sets a start, or the window is one day: only the deadline.
    rerender(<TaskDatesSummary {...base} openStart estimatedHours={null} />)
    expect(summary()).toHaveTextContent(/^Due 20 Sept · in 3 days$/)
    rerender(
      <TaskDatesSummary
        {...base}
        placement={{ start: day('2099-09-20'), end: day('2099-09-20'), daysLate: null }}
      />,
    )
    expect(summary()).toHaveTextContent(/^Due 20 Sept · in 3 daysEffort: about 6 hours$/)

    // Handed in, how far away no longer matters.
    rerender(<TaskDatesSummary {...base} handedIn />)
    expect(summary()).toHaveTextContent(/^Due 20 Sept \(from 14 Sept\)Effort/)
  })

  it('says when it is late: overdue once the deadline passes, or planned past it', () => {
    const { rerender } = render(<TaskDatesSummary {...base} deadline={day('2099-09-15')} />)
    expect(screen.getByText(/2 days overdue/)).toHaveClass('text-error')
    expect(screen.queryByText(/Planned to finish/)).toBeNull()

    rerender(
      <TaskDatesSummary
        {...base}
        placement={{ start: day('2099-09-21'), end: day('2099-09-23'), daysLate: 3 }}
      />,
    )
    expect(screen.getByText('Planned to finish 3 days late')).toHaveClass('text-error')
    rerender(
      <TaskDatesSummary
        {...base}
        handedIn
        placement={{ start: day('2099-09-21'), end: day('2099-09-23'), daysLate: 3 }}
      />,
    )
    expect(screen.queryByText(/Planned to finish|overdue/)).toBeNull()
  })

  it('reads a task with no deadline, planned or not', () => {
    const { rerender } = render(<TaskDatesSummary {...base} deadline={null} />)
    expect(summary()).toHaveTextContent(/^No deadline set · planned 14 – 20 SeptEffort/)
    rerender(<TaskDatesSummary {...base} deadline={null} placement={null} estimatedHours={null} />)
    expect(summary()).toHaveTextContent(/^No deadline set$/)
  })
})
