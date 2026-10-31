interface TourPromptProps {
  onStart: () => void
  onDismiss: () => void
}

export function TourPrompt({ onStart, onDismiss }: TourPromptProps) {
  return (
    <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>First visit? A short tour marks each part of the page.</span>
      <button type="button" className="link" onClick={onStart}>
        Start tour
      </button>
      <button type="button" className="link" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
