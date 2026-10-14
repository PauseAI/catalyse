'use client'

import { useState } from 'react'
import Button from '@/components/Button'
import { ThemeToggle } from '@/components/ThemeToggle'
import Tabs from '@/components/Tabs'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1">{title}</h2>
      <div className="bg-surface rounded-xl shadow p-4 sm:p-6">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap mb-4 last:mb-0">
      <span className="text-text-light text-sm min-w-[80px]">{label}</span>
      {children}
    </div>
  )
}

export default function ComponentPreviewPage() {
  const [activeTab, setActiveTab] = useState('one')
  const [dismissed, setDismissed] = useState(false)
  const [tasks, setTasks] = useState(['Build landing page', 'Write copy'])

  return (
    <main className="container py-5 pb-15">
      <h1>Component Preview</h1>
      <p className="text-text-light mb-8">All button variants and patterns used across the app.</p>

      {/* ── Button component ─────────────────────────────────────── */}
      <Section title="Button — variants × sizes">
        <Row label="primary">
          <Button>Primary md</Button>
          <Button size="sm">Primary sm</Button>
          <Button disabled>Primary md</Button>
          <Button icon aria-label="Add">
            +
          </Button>
          <Button icon size="sm" aria-label="Add">
            +
          </Button>
        </Row>
        <Row label="secondary">
          <Button variant="secondary">Secondary md</Button>
          <Button variant="secondary" size="sm">
            Secondary sm
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" icon aria-label="Add">
            +
          </Button>
          <Button variant="secondary" icon size="sm" aria-label="Add">
            +
          </Button>
        </Row>
        <Row label="danger">
          <Button variant="danger">Danger md</Button>
          <Button variant="danger" size="sm">
            Danger sm
          </Button>
          <Button variant="danger" disabled>
            Disabled
          </Button>
          <Button variant="danger" icon aria-label="Remove">
            ×
          </Button>
          <Button variant="danger" icon size="sm" aria-label="Remove">
            ×
          </Button>
        </Row>
        <Row label="ghost">
          <Button variant="ghost">Ghost md</Button>
          <Button variant="ghost" size="sm">
            Ghost sm
          </Button>
          <Button variant="ghost" disabled>
            Disabled
          </Button>
          <Button variant="ghost" icon aria-label="Add">
            +
          </Button>
          <Button variant="ghost" icon size="sm" aria-label="Add">
            +
          </Button>
        </Row>
        <Row label="outline">
          <Button variant="outline">Outline md</Button>
          <Button variant="outline" size="sm">
            Outline sm
          </Button>
          <Button variant="outline" disabled>
            Disabled
          </Button>
          <Button variant="outline" icon aria-label="Add">
            +
          </Button>
          <Button variant="outline" icon size="sm" aria-label="Add">
            +
          </Button>
        </Row>
      </Section>

      <Section title="Button — as Link (href)">
        <Row label="primary">
          <Button href="/component-preview">Primary link</Button>
          <Button href="/component-preview" size="sm">
            Primary sm link
          </Button>
        </Row>
        <Row label="secondary">
          <Button href="/component-preview" variant="secondary">
            Secondary link
          </Button>
          <Button href="/component-preview" variant="outline" size="sm">
            Outline sm link
          </Button>
        </Row>
      </Section>

      <Section title="Button — className overrides">
        <Row label="w-full">
          <div className="w-[320px]">
            <Button className="w-full">Full-width (login / reset-password)</Button>
          </div>
        </Row>
        <Row label="secondary">
          <Button variant="secondary">Secondary (privacy page delete link)</Button>
        </Row>
      </Section>

      <Section title="Button — dynamic variant (ternary)">
        <p className="text-text-light text-sm mb-3">
          Used in admin/triage tabs and quick-tasks status filters.
        </p>
        <Row label="md tabs">
          {['one', 'two', 'three'].map((t) => (
            <Button
              key={t}
              variant={activeTab === t ? 'primary' : 'secondary'}
              onClick={() => setActiveTab(t)}
            >
              Tab {t}
            </Button>
          ))}
        </Row>
        <Row label="sm filters">
          {['all', 'open', 'assigned', 'submitted'].map((s) => (
            <Button
              key={s}
              variant={activeTab === s ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setActiveTab(s)}
            >
              {s}
            </Button>
          ))}
        </Row>
      </Section>

      {/* ── Other button patterns ─────────────────────────────────── */}
      <Section title="Tabs — underline style">
        <p className="text-text-light text-sm mb-3">
          Navigation tabs — different visual system, not action buttons.
        </p>
        <Tabs
          tabs={[
            { key: 'Overview', label: 'Overview' },
            { key: 'Details', label: 'Details' },
            { key: 'History', label: 'History' },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          className="mb-4"
        />
        <p className="text-sm text-text-light">
          Active: <strong>{activeTab}</strong>
        </p>
      </Section>

      <Section title="Ghost icon × — close / dismiss / remove">
        <p className="text-text-light text-sm mb-3">
          All × buttons now use <code>{'<Button variant="ghost" icon>'}</code>.
        </p>
        <Row label="modal header">
          <div className="bg-surface border border-brand-border rounded-lg px-4 py-3 flex items-center gap-4 min-w-[280px]">
            <span className="font-medium flex-1">Modal Header</span>
            <Button variant="ghost" icon aria-label="Close">
              ×
            </Button>
          </div>
        </Row>
        <Row label="banner dismiss">
          {!dismissed ? (
            <div className="flex items-center justify-between gap-3 p-4 rounded-lg bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-600 min-w-[300px]">
              <span>Dismissible banner.</span>
              <Button variant="ghost" icon onClick={() => setDismissed(true)} aria-label="Dismiss">
                ×
              </Button>
            </div>
          ) : (
            <span className="text-text-light text-sm italic">
              Dismissed.{' '}
              <button className="underline cursor-pointer" onClick={() => setDismissed(false)}>
                Reset
              </button>
            </span>
          )}
        </Row>
        <Row label="remove item">
          <div className="flex flex-col gap-2 min-w-[280px]">
            {tasks.map((t, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-3 bg-brand-bg border border-brand-border rounded-lg"
              >
                <span className="text-sm flex-1">{t}</span>
                {tasks.length > 1 && (
                  <Button
                    variant="ghost"
                    icon
                    onClick={() => setTasks((ts) => ts.filter((_, j) => j !== i))}
                    aria-label="Remove task"
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Logout button (Header dropdown)">
        <p className="text-text-light text-sm mb-3">
          Ghost variant with error text colour override — sits inside dropdown menu.
        </p>
        <div className="bg-surface border border-brand-border rounded-lg min-w-[180px]">
          <Button
            variant="ghost"
            className="w-full justify-start px-4 py-3 text-error hover:text-error"
          >
            Logout
          </Button>
        </div>
      </Section>

      <Section title="ThemeToggle (Header)">
        <p className="text-text-light text-sm mb-3">Ghost icon button wrapping the theme emoji.</p>
        <Row label="">
          <ThemeToggle />
        </Row>
      </Section>
    </main>
  )
}
