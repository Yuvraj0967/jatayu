import { memo } from 'react'
import type { NextActionKind, NextActionResult } from '../lib/guide'
import { TONE_VAR } from '../lib/rf'
import { IconAlert, IconCheck, IconCritical, IconDot } from './Icons'

function ToneIcon({ tone }: { tone: NextActionResult['tone'] }) {
  if (tone === 'good') return <IconCheck size={14} />
  if (tone === 'warning' || tone === 'serious') return <IconAlert size={14} />
  if (tone === 'critical') return <IconCritical size={14} />
  return <IconDot size={14} />
}

interface NextActionProps {
  result: NextActionResult
  onAction: (kind: NextActionKind) => void
}

function NextActionBase({ result, onAction }: NextActionProps) {
  return (
    <section
      aria-live="polite"
      aria-atomic="true"
      aria-label="Next action"
      data-tour="next-action"
      className="flex min-w-0 flex-col gap-3 rounded-2xl border px-4 py-3.5 sm:flex-row sm:items-center"
      style={{
        borderColor: 'color-mix(in srgb, var(--mint) 28%, var(--hair))',
        background: 'color-mix(in srgb, var(--mint) 9%, var(--panel))',
      }}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{
            color: TONE_VAR[result.tone],
            background: `color-mix(in srgb, ${TONE_VAR[result.tone]} 14%, var(--panel))`,
          }}
          aria-hidden="true"
        >
          <ToneIcon tone={result.tone} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[0.6875rem] font-semibold" style={{ color: TONE_VAR[result.tone] }}>
            Next action
          </div>
          <p className="mt-0.5 text-[0.8125rem] font-semibold leading-snug">{result.title}</p>
          <p className="mt-0.5 text-[0.71875rem] leading-snug text-muted" title={result.detail}>
            {result.detail}
          </p>
        </div>
      </div>
      {result.action ? (
        <button
          type="button"
          className="btn btn-sm shrink-0 self-start sm:self-center"
          onClick={() => onAction(result.action!.kind)}
        >
          {result.action.label}
        </button>
      ) : null}
    </section>
  )
}

export const NextAction = memo(
  NextActionBase,
  (previous, next) =>
    previous.result.key === next.result.key &&
    previous.result.title === next.result.title &&
    previous.result.detail === next.result.detail &&
    previous.result.tone === next.result.tone &&
    previous.result.action?.kind === next.result.action?.kind &&
    previous.result.action?.label === next.result.action?.label &&
    previous.onAction === next.onAction,
)
