import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from './components/Layout'
import { EmailButton } from './components/EmailButton'
import { EmailFooter } from './components/Footer'

export type DigestProject = {
  id: number
  title: string
  description?: string
  skill_names?: string[]
  match_percent?: number
}

export type DigestEmailProps = {
  name: string
  appUrl: string
  projects: DigestProject[]
  isMatch?: boolean
}

function ProjectCard({ project, appUrl }: { project: DigestProject; appUrl: string }) {
  const skills = (project.skill_names || []).slice(0, 5).join(', ')
  const desc = project.description || ''
  const truncated = desc.length > 150 ? `${desc.slice(0, 150)}...` : desc
  return (
    <div
      style={{
        padding: 16,
        marginBottom: 12,
        background: '#f7fafc',
        borderRadius: 8,
        borderLeft: '4px solid #FF9416',
      }}
    >
      <a
        href={`${appUrl}/projects/${project.id}`}
        style={{ fontWeight: 'bold', color: '#1A202C', textDecoration: 'none', fontSize: 16 }}
      >
        {project.title}
      </a>
      {project.match_percent && (
        <span
          style={{
            background: '#D1FAE5',
            color: '#065F46',
            padding: '2px 8px',
            borderRadius: 10,
            fontSize: 12,
          }}
        >
          {` ${project.match_percent}% match`}
        </span>
      )}
      <p style={{ color: '#4A5568', margin: '8px 0 4px 0', fontSize: 14 }}>{truncated}</p>
      {skills && <p style={{ fontSize: 12, color: '#718096' }}>{`Skills: ${skills}`}</p>}
    </div>
  )
}

export function DigestEmail({ name, appUrl, projects, isMatch = false }: DigestEmailProps) {
  const matchIntro = isMatch
    ? 'Here are new projects that match your skills:'
    : "Here's what's new on Catalyse:"
  return (
    <EmailLayout width={600}>
      <Heading as="h2">Catalyse Project Update</Heading>
      <Text>{`Hi ${name},`}</Text>
      <Text>{matchIntro}</Text>
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} appUrl={appUrl} />
      ))}
      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <EmailButton href={appUrl}>Browse All Projects</EmailButton>
      </Section>
      <EmailFooter appUrl={appUrl} buttons={[{ label: 'Browse All Projects', url: appUrl }]} />
    </EmailLayout>
  )
}
