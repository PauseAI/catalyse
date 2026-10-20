import { Body, Container, Head, Html } from '@react-email/components'

const bodyStyle = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  lineHeight: 1.6,
  color: '#1a202c',
}

export function EmailLayout({
  children,
  width = 500,
}: {
  children: React.ReactNode
  width?: number
}) {
  return (
    <Html>
      <Head />
      <Body style={bodyStyle}>
        <Container style={{ maxWidth: width, margin: '0 auto', padding: 20 }}>{children}</Container>
      </Body>
    </Html>
  )
}
