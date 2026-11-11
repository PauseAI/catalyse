/** A bulleted list of links into the app, each with an optional line of detail under it. */
export function LinkList({
  appUrl,
  items,
}: {
  appUrl: string
  items: { text: string; href: string; detail?: string | null }[]
}) {
  return (
    <ul style={{ paddingLeft: 20, margin: 0 }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          <a href={`${appUrl}${item.href}`}>{item.text}</a>
          {item.detail && <div style={{ color: '#4a5568', fontSize: 14 }}>{item.detail}</div>}
        </li>
      ))}
    </ul>
  )
}
