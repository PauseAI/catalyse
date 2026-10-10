// Override with DEMO_PORT to run more than one recording at once — each run kills
// whatever else is listening on its port, so concurrent runs need different ones.
export const DEMO_PORT = Number(process.env.DEMO_PORT) || 3099
export const BASE_URL = `http://localhost:${DEMO_PORT}`
export const ADMIN_EMAIL = 'admin@example.com'
export const ADMIN_PASSWORD = 'password1'
// Approving applications requires isSuperAdmin (lib/auth.ts), which admin@example.com doesn't have.
export const SUPERADMIN_EMAIL = 'superadmin@example.com'
export const SUPERADMIN_PASSWORD = 'password1'
export const NOREPLY_EMAIL = 'noreply@pauseai.uk'
export const SPEED = 1 // <1 = slower, >1 = faster

export const APPLICANT = {
  name: 'Alex Chen',
  email: 'alex.chen@example.com',
  password: 'DemoPassword1',
  applicationMessage:
    "I've been following PauseAI's work for two years and believe AI safety is the defining challenge of our time. I'm a software engineer with ML experience and want to contribute to advocacy, technical writing, and community coordination.",
  bio: 'Software engineer focused on AI safety. Based in London.',
  discord: 'alexchen#4291',
  contactNotes: "Just let me know you're from PauseAI when you message, I'm available most evenings and weekends to help.",
  location: 'London, UK',
  country: 'UK',
  localGroup: 'London',
  availability: '8',
  preferredContact: 'Discord',
  adminNotes:
    'Strong application. ML background, two years following the org, clear on the mission.',
  skills: new Set([
    'Software Engineering',
    'Writing',
    'AI Governance Research',
    'Technical AI Safety Expertise',
  ]),
}

export const FLYER_PROJECT = {
  title: 'Downtown Flyering Stall',
  description:
    'Run a street stall in the city centre on Saturday mornings, handing out flyers about AI safety and talking to passers-by. Low commitment, high visibility — great for new volunteers.',
  taskOne: {
    title: 'Staff the stall, 10am-1pm Saturday',
    workNote:
      'Set up the stall at 10am, handed out around 80 flyers, and had a dozen good conversations. Packed down by 1pm.',
  },
  taskTwo: {
    title: 'Design and print 200 flyers',
    workNote:
      'Drafted the flyer in Canva, got it proofread, and sent it to the local print shop — 200 copies ready for pickup Friday.',
  },
}

export const FLYER_VOLUNTEER_ONE = {
  name: 'Priya Desai',
  email: 'priya.desai@example.com',
  password: 'DemoPassword1',
  bio: 'Based in Manchester, enjoys in-person outreach and street stalls.',
  country: 'UK',
  availabilityHoursPerWeek: 4,
  applicationMessage: 'Keen to get involved in local, in-person outreach work.',
}

export const FLYER_VOLUNTEER_TWO = {
  name: 'Tom Whitfield',
  email: 'tom.whitfield@example.com',
  password: 'DemoPassword1',
  bio: 'Graphic designer based in Leeds, happy to help with print materials.',
  country: 'UK',
  availabilityHoursPerWeek: 3,
  applicationMessage: 'I do graphic design professionally and want to help with materials.',
}

export const REJECT_APPLICANT = {
  name: 'Jordan Smith',
  email: 'jordan.smith@example.com',
  password: 'DemoPassword1',
  applicationMessage:
    "I'm building an AI startup and care deeply about doing it responsibly. I'd love to connect with like-minded people — and if any of you are interested in trying our product, even better!",
  bio: 'Founder of Meridian AI. Building responsible AI tools for enterprise. Always looking for early adopters.',
  discordHandle: 'jordansmith#7734',
  contactPreference: 'discord',
  contactNotes: 'Always happy to chat — especially if you work in AI governance or product.',
  availabilityHoursPerWeek: '3',
  location: 'San Francisco, CA',
  country: 'United States',
  adminNotes: 'Seems that the application is mostly about finding users for their startup.',
  rejectionMessage:
    "Thank you for applying. After careful review, we don't think this is the right fit at this time.",
}
