export function LimitsBanner() {
  return (
    <p
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.71875rem] leading-snug"
      style={{
        background: 'color-mix(in srgb, var(--warning) 11%, var(--panel))',
        color: 'var(--warning)',
      }}
    >
      <span
        className="inline-block h-[6px] w-[6px] shrink-0 rounded-full"
        style={{ background: 'var(--warning)' }}
        aria-hidden="true"
      />
      <span>
        <span className="font-semibold">Limits:</span> experimental prototype, not a life-safety instrument.
      </span>
    </p>
  )
}
