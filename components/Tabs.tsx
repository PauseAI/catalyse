'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

export interface TabItem<T extends string = string> {
  key: T
  label: React.ReactNode
  'data-tab'?: string
  'aria-selected'?: boolean
}

interface TabsProps<T extends string = string> {
  tabs: TabItem<T>[]
  activeTab: T
  onChange: (key: T) => void
  role?: string
  className?: string
}

// Fades the strip's right edge while tabs lie beyond it, so a clipped tab reads as "scroll for more".
const FADE_RIGHT = '[mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)]'

export default function Tabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  role,
  className = 'mb-6',
}: TabsProps<T>) {
  const strip = useRef<HTMLDivElement>(null)
  const [moreRight, setMoreRight] = useState(false)
  const measure = useCallback(() => {
    const el = strip.current!
    setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure, tabs.length])

  return (
    <div
      ref={strip}
      role={role}
      onScroll={measure}
      className={`flex overflow-x-auto border-b border-brand-border ${moreRight ? FADE_RIGHT : ''} ${className}`}
    >
      {tabs.map(({ key, label, 'data-tab': dataTab }) => (
        <button
          key={key}
          role="tab"
          aria-selected={activeTab === key}
          data-tab={dataTab}
          className={`shrink-0 whitespace-nowrap px-5 py-3 font-medium border-b-2 -mb-px cursor-pointer transition-colors ${
            activeTab === key
              ? 'active text-primary border-primary'
              : 'text-text-light border-transparent hover:text-brand-text'
          }`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
