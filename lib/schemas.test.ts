import { describe, it, expect } from 'vitest'
import {
  SignupSchema,
  CompleteGoogleSignupSchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  UpdateProjectTaskSchema,
  DependencyBodySchema,
  ApplicationActionSchema,
  UpdateVolunteerSchema,
  sanitisePersonName,
} from './schemas'

const signup = {
  name: 'Ann',
  email: 'ann@example.com',
  password: 'longenough',
  bio: 'A bio that is definitely longer than twenty characters',
  country: 'UK',
  availabilityHoursPerWeek: 5,
  applicationMessage: 'An application message that is long enough',
}

describe('SignupSchema', () => {
  it('accepts a complete signup and reports the custom messages', () => {
    expect(SignupSchema.safeParse(signup).success).toBe(true)
    const bad = SignupSchema.safeParse({
      ...signup,
      email: 'nope',
      password: 'short',
      bio: 'short',
      country: '',
      availabilityHoursPerWeek: 50,
      applicationMessage: 'short',
    })
    expect(bad.success).toBe(false)
    const messages = bad.error!.issues.map((i) => i.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'A valid email address is required',
        'Password must be at least 8 characters',
        'Please write at least 20 characters',
        'Country is required',
        'Availability must be no more than 40 hours per week',
      ]),
    )
  })

  it('keeps links and hidden characters out of names, on signup and on profile edits', () => {
    for (const name of [
      'PauseAI Security: re-verify at https://evil.example',
      'see www.evil.example',
      'evil.example/login',
      'Ann‮evil',
      'Ann​Smith',
      'Ann\nSmith',
      'x'.repeat(81),
    ]) {
      expect(SignupSchema.safeParse({ ...signup, name }).success).toBe(false)
      expect(UpdateVolunteerSchema.safeParse({ name }).success).toBe(false)
    }
    for (const name of ["Siobhán O'Connor-Smith", 'Dr. J. R. Müller', '李小龍', '  Ann  ']) {
      expect(SignupSchema.safeParse({ ...signup, name }).success).toBe(true)
    }
    expect(SignupSchema.parse({ ...signup, name: '  Ann  ' }).name).toBe('Ann')
  })

  it('bounds the free-text and contact fields, on signup and on profile edits', () => {
    const tooLong = {
      email: `${'a'.repeat(250)}@example.com`,
      bio: 'x'.repeat(2001),
      applicationMessage: 'x'.repeat(5001),
      location: 'x'.repeat(201),
      otherSkills: 'x'.repeat(501),
      discordHandle: 'x'.repeat(101),
      contactNotes: 'x'.repeat(501),
      skillIds: Array(51).fill(1),
    }
    for (const [field, value] of Object.entries(tooLong)) {
      expect(SignupSchema.safeParse({ ...signup, [field]: value }).success, field).toBe(false)
      if (field !== 'email') {
        expect(UpdateVolunteerSchema.safeParse({ [field]: value }).success, field).toBe(false)
      }
    }
    expect(
      SignupSchema.safeParse({ ...signup, bio: 'x'.repeat(2000), skillIds: Array(50).fill(1) })
        .success,
    ).toBe(true)
  })

  it('cleans a name it cannot ask anyone to retype', () => {
    expect(sanitisePersonName('Ann Smith')).toBe('Ann Smith')
    expect(sanitisePersonName('Ann https://evil.example/x')).toBe('Ann https: evil.example x')
    expect(sanitisePersonName(`${'x'.repeat(100)}`)).toHaveLength(80)
    expect(sanitisePersonName('​//')).toBe('New volunteer')
  })

  it('Google signup drops email/password/name and adds the credential', () => {
    const { email: _e, password: _p, name: _n, ...rest } = signup
    expect(
      CompleteGoogleSignupSchema.safeParse({ ...rest, credential: 'c', stub: true }).success,
    ).toBe(true)
  })
})

describe('project and task schemas', () => {
  it('CreateProjectSchema fills defaults for the optional arrays and flags', () => {
    const parsed = CreateProjectSchema.parse({
      title: 'T',
      description: 'D',
      projectType: 'sprint',
      estimatedDuration: '2 weeks',
      timeCommitmentHoursPerWeek: 2,
      urgency: 'low',
      collaborationLink: null,
      country: 'UK',
      localGroup: null,
      isSeekingHelp: true,
    })
    expect(parsed).toMatchObject({
      tasks: [],
      wantToOwn: false,
      skillIds: [],
      skillRequiredMap: {},
      saveAsDraft: false,
    })
  })

  it('takes only http(s) links as the project doc, since the page renders it as a link', () => {
    const base = {
      title: 'T',
      description: 'D',
      projectType: 'sprint',
      estimatedDuration: '2 weeks',
      timeCommitmentHoursPerWeek: 2,
      urgency: 'low',
      country: 'UK',
      localGroup: null,
      isSeekingHelp: true,
    }
    for (const link of ['https://doc.example', 'http://doc.example/a?b=c', '', null]) {
      expect(CreateProjectSchema.safeParse({ ...base, collaborationLink: link }).success).toBe(true)
      expect(UpdateProjectSchema.safeParse({ collaborationLink: link }).success).toBe(true)
    }
    for (const link of ['javascript:alert(1)', 'doc.example', 'ftp://x', 'https://a b']) {
      const create = CreateProjectSchema.safeParse({ ...base, collaborationLink: link })
      expect(create.success).toBe(false)
      expect(create.error?.issues[0].message).toBe('The link must start with http:// or https://')
      expect(UpdateProjectSchema.safeParse({ collaborationLink: link }).success).toBe(false)
    }
  })

  it('UpdateProjectTaskSchema accepts the enum status and DependencyBodySchema bounds lag', () => {
    expect(UpdateProjectTaskSchema.safeParse({ status: 'completed' }).success).toBe(true)
    expect(UpdateProjectTaskSchema.safeParse({ status: 'nonsense' }).success).toBe(false)
    expect(DependencyBodySchema.parse({ predecessorId: 1, successorId: 2 }).lagDays).toBe(0)
    expect(
      DependencyBodySchema.safeParse({ predecessorId: 1, successorId: 2, lagDays: 400 }).success,
    ).toBe(false)
  })
})

describe('admin and profile schemas', () => {
  it('ApplicationActionSchema restricts the action', () => {
    expect(ApplicationActionSchema.safeParse({ action: 'approve' }).success).toBe(true)
    const bad = ApplicationActionSchema.safeParse({ action: 'nuke' })
    expect(bad.success).toBe(false)
    expect(bad.error!.issues[0].message).toContain('action must be')
  })

  it('UpdateVolunteerSchema is partial but validates the application message', () => {
    expect(UpdateVolunteerSchema.safeParse({}).success).toBe(true)
    expect(UpdateVolunteerSchema.safeParse({ applicationMessage: null }).success).toBe(true)
    expect(UpdateVolunteerSchema.safeParse({ applicationMessage: 'short' }).success).toBe(false)
    expect(UpdateVolunteerSchema.safeParse({ email: 'x@y.z' } as never)).toMatchObject({
      success: true,
    })
  })
})
