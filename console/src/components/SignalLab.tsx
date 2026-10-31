import { Panel } from './Panel'
import { IconExternal } from './Icons'

interface SignalLabProps {
  apiBase: string
  demo: boolean
  onOpenSettings: () => void
}

export function SignalLab({ apiBase, demo, onOpenSettings }: SignalLabProps) {
  const url = `${apiBase.replace(/\/+$/, '')}/csi?embed=1`

  return (
    <Panel
      title="Signal lab"
      id="signal-lab"
      help="The signal lab is a separate page served by the backend for waveform, spectrum and calibration work. Use it to check the link before relying on observations; it is a diagnostic view, not an alarm."
      right={
        <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer noopener">
          Open in its own tab
          <IconExternal size={11} />
        </a>
      }
    >
      <div className="px-4 py-3.5">
        <p className="text-[0.78125rem] leading-relaxed">
          Do the 30-second empty-room calibration here before real use.
        </p>
        <p className="machine mt-1.5 text-[0.6875rem] text-muted">{url}</p>
      </div>

      {demo ? (
        <div className="px-4 pb-5 pt-2">
          <p className="font-display text-[0.875rem] font-semibold">No feed in demo mode</p>
          <p className="mt-1.5 max-w-[62ch] text-[0.78125rem] leading-relaxed text-muted">
            The signal lab draws from the live CSI stream, so it has nothing to show here. Start the backend, connect the
            ESP32, and set the API address in Settings. The console leaves demo mode on its own once the backend answers.
          </p>
          <dl
            className="machine mt-4 grid max-w-[46ch] grid-cols-[7.5rem_1fr] gap-y-1.5 rounded-xl px-3.5 py-3 text-[0.6875rem]"
            style={{ background: 'var(--panel2)' }}
          >
            <dt className="text-muted">Backend</dt>
            <dd>{apiBase}</dd>
            <dt className="text-muted">Stream</dt>
            <dd>/csi?embed=1</dd>
            <dt className="text-muted">Calibration</dt>
            <dd>30 s empty room, before use</dd>
          </dl>
          <button type="button" className="btn btn-sm mt-4" onClick={onOpenSettings}>
            Open settings
          </button>
        </div>
      ) : (
        <div className="px-3 pb-3">
          <iframe
            title="Signal lab: live waveform, spectrum and calibration"
            src={url}
            className="block w-full rounded-xl border-0"
            style={{ height: 'min(72vh, 760px)', minHeight: 480, background: 'var(--panel2)' }}
          />
        </div>
      )}
    </Panel>
  )
}
