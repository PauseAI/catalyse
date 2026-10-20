import { Button } from '@react-email/components'

const buttonStyle = {
  display: 'inline-block',
  background: '#FF9416',
  color: '#ffffff',
  padding: '12px 24px',
  textDecoration: 'none',
  borderRadius: 6,
  fontWeight: 'bold' as const,
}

export function EmailButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button href={href} style={buttonStyle}>
      {children}
    </Button>
  )
}
