import { faker } from '@faker-js/faker'
import { createHash } from 'node:crypto'

/**
 * Seed the generator from a test's project and title, so the same test always
 * makes the same people, projects and prose, and no two tests, nor one test
 * in two lanes, share a sequence. The names still read as real names; only
 * their choice is fixed.
 */
export function seedFake(title: string): void {
  faker.seed(createHash('sha1').update(title).digest().readUInt32BE(0))
}

// Names that tests look things up by get a random tag: faker draws from finite lists, and
// every test a worker runs shares one database, so bare names repeat.
const unique = (name: string) => `${name} ${faker.string.alpha({ length: 4, casing: 'upper' })}`

export const fake = {
  person: () => {
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()
    return {
      name: `${firstName} ${lastName}`,
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
    }
  },
  personName: () => faker.person.fullName(),
  projectTitle: () => unique(faker.company.catchPhrase()),
  skillCategory: () => unique(`${faker.word.adjective()} ${faker.word.noun()}`),
  skillName: () => unique(`${faker.word.adjective()} ${faker.word.noun()}`),
  quickTaskTitle: () => unique(`${faker.word.verb()} ${faker.word.noun()} ${faker.word.noun()}`),
  bugTitle: () => unique(faker.lorem.sentence()),
  note: () => faker.lorem.sentence(),
  messageSubject: () => faker.lorem.words(4),
  messageBody: () => faker.lorem.paragraph(),
  feedbackText: () => faker.lorem.sentence(),
  progressUpdate: () => faker.lorem.sentence(),
  outcomeNotes: () => faker.lorem.sentence(),
  resolutionNotes: () => faker.lorem.sentence(),
  uniqueEmail: () => faker.internet.email().toLowerCase(),
  username: () => faker.internet.username(),
  phoneNumber: () => faker.phone.number({ style: 'international' }),
  localGroupName: () => unique(faker.location.city()),
  teamName: () => unique(`${faker.word.adjective()} ${faker.word.noun()} Squad`),
}
