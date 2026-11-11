/** A small count beside a heading, left out at zero. */
export default function Count({ n }: { n: number }) {
  if (n === 0) return null
  return (
    <span className="bg-chip text-chip-text text-xs px-2 py-0.5 rounded-full ml-2 align-middle">
      {n}
    </span>
  )
}
