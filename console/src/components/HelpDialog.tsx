import type { ReactNode } from 'react'
import {
  commandGlossary,
  incidentGlossary,
  pageMap,
  qualityGlossary,
  rfGlossary,
  startHere,
  whenWrong,
  whatThisIsNot,
  type GlossaryEntry,
} from '../lib/glossary'
import { Dialog } from './ui'

interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

function Entries({ entries, mono }: { entries: GlossaryEntry[]; mono?: boolean }) {
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {entries.map((entry) => (
        <div key={entry.term}>
          <dt className={mono ? 'machine text-[0.6875rem] font-semibold' : 'text-[0.75rem] font-semibold'}>
            {entry.term}
          </dt>
          <dd className="mt-0.5 text-[0.71875rem] leading-relaxed text-muted">{entry.text}</dd>
        </div>
      ))}
    </dl>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t pt-4 first:border-t-0 first:pt-0" style={{ borderColor: 'var(--hair)' }}>
      <h3 className="font-display text-[0.8125rem] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Help and glossary"
      subtitle="Plain-language notes for operating the console. Nothing here is a medical or safety measurement."
      width={800}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="space-y-4">
        <Section title="Start here">
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[0.71875rem] leading-snug">
            {startHere.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </Section>

        <Section title="Map of this page">
          <Entries entries={pageMap} />
        </Section>

        <Section title="RF states">
          <Entries entries={rfGlossary} mono />
        </Section>

        <Section title="Quality, confidence and gas terms">
          <Entries entries={qualityGlossary} />
        </Section>

        <div className="grid gap-4 sm:grid-cols-2">
          <Section title="Incident states">
            <Entries entries={incidentGlossary} />
          </Section>
          <Section title="Command stages">
            <Entries entries={commandGlossary} />
          </Section>
        </div>

        <Section title="When something looks wrong">
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[0.71875rem] leading-snug">
            {whenWrong.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>

        <Section title="What this is not">
          <ul className="mt-1.5 space-y-1">
            {whatThisIsNot.map((line) => (
              <li key={line} className="border-l-2 pl-2 text-[0.71875rem] leading-snug" style={{ borderColor: 'var(--serious)' }}>
                {line}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </Dialog>
  )
}
