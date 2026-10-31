import type { ViewMode } from '../settings/SettingsContext'

interface ToolbarProps {
  view: ViewMode
  textSize: number
  onViewChange: (view: ViewMode) => void
  onTextSmaller: () => void
  onTextLarger: () => void
  onStartTour: () => void
  onOpenHelp: () => void
}

export function Toolbar({
  view,
  textSize,
  onViewChange,
  onTextSmaller,
  onTextLarger,
  onStartTour,
  onOpenHelp,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="label">View</span>
          <div className="seg" role="group" aria-label="View density">
            {(['simple', 'detailed'] as const).map((option) => {
              const selected = view === option
              return (
                <button
                  key={option}
                  type="button"
                  className="px-3 py-1 capitalize"
                  aria-pressed={selected}
                  onClick={() => onViewChange(option)}
                >
                  {option}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="label">Text size</span>
          <button
            type="button"
            className="btn btn-sm !h-7 !w-7 !px-0"
            onClick={onTextSmaller}
            disabled={textSize <= 0}
            aria-label="Decrease text size"
            title="Decrease text size"
          >
            A−
          </button>
          <span className="mono w-8 text-center text-[0.6875rem] font-semibold text-muted" aria-live="polite">
            {textSize + 1}/5
          </span>
          <button
            type="button"
            className="btn btn-sm !h-7 !w-7 !px-0"
            onClick={onTextLarger}
            disabled={textSize >= 4}
            aria-label="Increase text size"
            title="Increase text size"
          >
            A+
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="link" onClick={onStartTour}>
          Take the tour
        </button>
        <button type="button" className="link" data-tour="help" onClick={onOpenHelp}>
          Help and glossary
        </button>
      </div>
    </div>
  )
}
