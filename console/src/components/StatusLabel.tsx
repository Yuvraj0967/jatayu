import { TONE_VAR, type Tone } from '../lib/rf'
import { sentence } from '../lib/format'
import { IconAlert, IconCheck, IconCritical, IconDot } from './Icons'

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === 'good') return <IconCheck size={10} />
  if (tone === 'warning' || tone === 'serious') return <IconAlert size={10} />
  if (tone === 'critical') return <IconCritical size={10} />
  return <IconDot size={10} />
}

export function StatusLabel({
  tone,
  children,
  title,
}: {
  tone: Tone
  children: string
  title?: string
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold leading-[1.45]"
      style={{
        border: `1px solid color-mix(in srgb, ${TONE_VAR[tone]} 22%, transparent)`,
        background: `color-mix(in srgb, ${TONE_VAR[tone]} 11%, transparent)`,
        color: TONE_VAR[tone],
      }}
      title={title}
    >
      <span className="inline-flex">
        <ToneIcon tone={tone} />
      </span>
      {sentence(children)}
    </span>
  )
}
