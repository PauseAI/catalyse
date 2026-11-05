import { P } from '@/components/Text'
import TextLink from '@/components/TextLink'

// What PauseAI's volunteers have achieved. Answers the "will any of this make a difference?"
// objection, for visitors deciding whether to apply and for applicants waiting to start.
const TRACK_RECORD: { when: string; body: React.ReactNode }[] = [
  {
    when: 'Open Letter to Demis Hassabis, August 2025',
    body: (
      <>
        We published an{' '}
        <TextLink
          href="https://pauseai.info/dear-sir-demis-2025"
          target="_blank"
          rel="noopener noreferrer"
        >
          open letter
        </TextLink>{' '}
        signed by over 60 UK politicians, in response to Google DeepMind failing to uphold its AI
        safety commitments. Several of the MPs who signed later spoke in the{' '}
        <TextLink
          href="https://www.bbc.co.uk/iplayer/episode/m002nr42/westminster-hall-10122025"
          target="_blank"
          rel="noopener noreferrer"
        >
          Westminster Hall debate
        </TextLink>{' '}
        that we helped to organise in December.
      </>
    ),
  },
  {
    when: 'Westminster Hall Debate, December 2025',
    body: 'We proposed and helped to organise a Westminster Hall debate in Parliament on AI Safety. We wrote a memo which was sent out to all MPs prior to the debate and also helped to draft some proposition speeches, putting us in a strong position to work with those MPs when proposing amendments to the Cyber Security and Resilience Bill.',
  },
  {
    when: 'March for AI Safety, February 2026',
    body: (
      <>
        We co-organised a march past the offices of OpenAI and Big Tech companies in King&apos;s
        Cross, London. It was the largest ever protest focused exclusively on the risks of AI, with
        around 300 people marching and media coverage in{' '}
        <TextLink
          href="https://www.technologyreview.com/2026/03/02/1133814/i-checked-out-londons-biggest-ever-anti-ai-protest/"
          target="_blank"
          rel="noopener noreferrer"
        >
          MIT Technology Review
        </TextLink>
        ,{' '}
        <TextLink
          href="https://www.independent.co.uk/tech/ai-safety-declaration-steve-bannon-b2932570.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          The Independent
        </TextLink>
        ,{' '}
        <TextLink
          href="https://www.wsj.com/tech/ai/ai-companies-public-relations-ae312d79"
          target="_blank"
          rel="noopener noreferrer"
        >
          The Wall Street Journal
        </TextLink>{' '}
        and{' '}
        <TextLink href="https://pauseai.uk/#news" target="_blank" rel="noopener noreferrer">
          others
        </TextLink>
        .
      </>
    ),
  },
]

/** `background` is the cards' fill: the opposite of whatever they sit on. */
export default function TrackRecord({
  background = 'bg-brand-bg',
}: {
  background?: 'bg-brand-bg' | 'bg-surface'
}) {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-3 gap-5 list-none p-0 m-0">
      {TRACK_RECORD.map((item) => (
        <li
          key={item.when}
          className={`${background} border border-brand-border rounded-xl p-4 sm:p-6`}
        >
          <P className="font-heading text-xs font-bold uppercase tracking-widest text-primary-dark mb-2">
            {item.when}
          </P>
          <P className="text-sm text-text-light mb-0">{item.body}</P>
        </li>
      ))}
    </ul>
  )
}
