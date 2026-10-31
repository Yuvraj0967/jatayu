import { useMemo, useState } from 'react'
import type { Incident, IncidentDetail } from '../api/types'
import { fmtTime, plural, sentence } from '../lib/format'
import { INCIDENT_TONE } from '../lib/rf'
import { IconPlus } from './Icons'
import { Panel } from './Panel'
import { StatusLabel } from './StatusLabel'
import { Dialog, Tooltip } from './ui'

interface IncidentsPanelProps {
  incidents: Incident[]
  selectedId: number | null
  detail: IncidentDetail | null
  detailLoading: boolean
  onSelect: (id: number) => void
  onNewIncident: (summary: string) => Promise<void>
  onRequestInspection: (notes?: string) => Promise<void>
  onAddNote: (id: number, text: string) => Promise<void>
  onAcknowledge: (id: number, notes?: string) => Promise<void>
  onCloseIncident: (id: number, notes?: string) => Promise<void>
  className?: string
}

const SUMMARY_MIN = 3
const SUMMARY_MAX = 200

export function IncidentsPanel({
  incidents,
  selectedId,
  detail,
  detailLoading,
  onSelect,
  onNewIncident,
  onRequestInspection,
  onAddNote,
  onAcknowledge,
  onCloseIncident,
  className,
}: IncidentsPanelProps) {
  const [newOpen, setNewOpen] = useState(false)
  const [inspectionOpen, setInspectionOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const [inspectionNotes, setInspectionNotes] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<string | null>(null)

  const openCount = incidents.filter((incident) => incident.status === 'open').length
  const canClose = detail?.status === 'acknowledged'
  const trimmedSummary = summary.trim()
  const summaryValid = trimmedSummary.length >= SUMMARY_MIN && trimmedSummary.length <= SUMMARY_MAX

  const sorted = useMemo(
    () =>
      [...incidents].sort((a, b) => {
        if (a.status === 'closed' && b.status !== 'closed') return 1
        if (b.status === 'closed' && a.status !== 'closed') return -1
        return b.created_at - a.created_at
      }),
    [incidents],
  )

  async function run(key: string, action: () => Promise<void>) {
    setPending(key)
    try {
      await action()
    } catch {
      /* the calling layer already surfaces the error as a toast */
    } finally {
      setPending(null)
    }
  }

  const notesForAck = note.trim() ? note.trim() : undefined

  return (
    <Panel
      className={className}
      title="Incidents"
      tour="incidents"
      id="incidents-panel"
      help="An incident is a record for a human to review. A pattern or reading opens one; acknowledging records that you looked at the evidence; closing ends it. Closing is blocked until an acknowledgement exists, so the record always shows who reviewed it."
      right={
        <>
          <button type="button" className="btn btn-sm" onClick={() => setInspectionOpen(true)}>
            Request inspection
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setNewOpen(true)}>
            <IconPlus size={11} />
            New incident
          </button>
        </>
      }
    >
      <div className="grid min-h-[320px] grid-cols-1 md:grid-cols-[minmax(210px,36%)_1fr]">
        <div
          className="min-w-0 border-b md:rounded-bl-[15px] md:border-b-0 md:border-r"
          style={{ borderColor: 'var(--hair)', background: 'var(--panel2)' }}
        >
          <div className="flex items-baseline justify-between gap-2 px-4 py-2.5">
            <span className="font-display text-[0.78125rem] font-semibold">Ledger</span>
            <span className="mono text-[0.6875rem] text-muted">
              {incidents.length} {plural(incidents.length, 'record')} · {openCount} open
            </span>
          </div>
          <ul className="max-h-[308px] overflow-y-auto px-2 pb-2 md:max-h-[560px]" aria-label="Incident list">
            {sorted.length ? (
              sorted.map((incident) => {
                const selected = incident.id === selectedId
                return (
                  <li key={incident.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(incident.id)}
                      aria-current={selected ? 'true' : undefined}
                      className="incident-row block w-full rounded-xl px-3 py-2.5 text-left transition-colors duration-150"
                      style={{
                        background: selected ? 'var(--mint-soft)' : undefined,
                        boxShadow: selected ? 'inset 3px 0 0 var(--mint-deep)' : undefined,
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="machine text-[0.6875rem] font-semibold tracking-[0.02em]">
                          {incident.incident_code}
                        </span>
                        <span className="ml-auto">
                          <StatusLabel tone={INCIDENT_TONE[incident.status] ?? 'neutral'}>
                            {incident.status}
                          </StatusLabel>
                        </span>
                      </span>
                      <span className="mt-1 block text-[0.75rem] leading-snug text-ink">{incident.summary}</span>
                      <span className="mt-1 block text-[0.6875rem] text-muted">
                        {fmtTime(incident.created_at)} · {incident.source}
                      </span>
                    </button>
                  </li>
                )
              })
            ) : (
              <li className="px-2 py-5 text-[0.75rem] leading-relaxed text-muted">
                No incidents yet. They appear here when monitoring observes something notable, or when you add one
                manually.
              </li>
            )}
          </ul>
        </div>

        <div className="min-w-0">
          {detailLoading ? (
            <p className="px-4 py-6 text-[0.75rem] text-muted">Loading incident record…</p>
          ) : !detail ? (
            <div className="px-4 py-8">
              <p className="text-[0.75rem] leading-relaxed text-muted">
                Select a record to see its evidence and acknowledgements.
              </p>
            </div>
          ) : (
            <div>
              <div className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="machine text-[0.75rem] font-semibold tracking-[0.02em]">{detail.incident_code}</span>
                  <StatusLabel tone={INCIDENT_TONE[detail.status] ?? 'neutral'}>{detail.status}</StatusLabel>
                  <span className="mono ml-auto text-[0.6875rem] text-muted">
                    opened {fmtTime(detail.created_at)}
                  </span>
                </div>
                <p className="mt-2 text-[0.875rem] font-medium leading-snug">{detail.summary}</p>
                <p className="mt-1 text-[0.6875rem] text-muted">
                  source {detail.source} · updated {fmtTime(detail.updated_at)}
                </p>
              </div>

              <div className="border-t px-4 py-3.5" style={{ borderColor: 'var(--hair)' }}>
                <h3 className="font-display text-[0.78125rem] font-semibold">Evidence</h3>
                {detail.observations.length ? (
                  <ul className="mt-2 space-y-2">
                    {detail.observations.map((observation) => (
                      <li
                        key={observation.id}
                        className="rounded-xl px-3 py-2"
                        style={{ background: 'var(--panel2)' }}
                      >
                        <div className="text-[0.6875rem] font-semibold text-muted">
                          {sentence(observation.observation_type)} · {fmtTime(observation.created_at)}
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-[0.75rem] leading-relaxed">
                          {observation.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[0.71875rem] text-muted">
                    No evidence recorded. Add a note below to describe what you saw.
                  </p>
                )}
              </div>

              <div className="border-t px-4 py-3.5" style={{ borderColor: 'var(--hair)' }}>
                <h3 className="font-display text-[0.78125rem] font-semibold">Acknowledgements</h3>
                {detail.acknowledgements.length ? (
                  <ul className="mt-2 space-y-2">
                    {detail.acknowledgements.map((ack, index) => (
                      <li key={`${ack.acknowledged_at}-${index}`} className="text-[0.75rem] leading-relaxed">
                        <span className="font-semibold">{sentence(ack.operator_action)}</span>
                        <span className="text-muted"> · {fmtTime(ack.acknowledged_at)} · {ack.channel}</span>
                        {ack.notes ? <p className="mt-0.5 whitespace-pre-wrap break-words text-muted">{ack.notes}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[0.71875rem] text-muted">Not acknowledged yet. A person must review the evidence.</p>
                )}
              </div>

              <div className="border-t px-4 py-3.5" style={{ borderColor: 'var(--hair)' }}>
                <label htmlFor="incident-note" className="label">
                  Operator note
                </label>
                <textarea
                  id="incident-note"
                  className="input mt-1.5 min-h-[58px] resize-y"
                  value={note}
                  maxLength={500}
                  placeholder="What did you check? Keep it factual."
                  onChange={(event) => setNote(event.target.value)}
                  disabled={detail.status === 'closed'}
                />
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!note.trim() || detail.status === 'closed' || pending != null}
                    onClick={() =>
                      void run('note', async () => {
                        await onAddNote(detail.id, note.trim())
                        setNote('')
                      })
                    }
                  >
                    {pending === 'note' ? 'Adding…' : 'Add note'}
                  </button>

                  <button
                    type="button"
                    className={detail.status === 'open' ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                    disabled={detail.status !== 'open' || pending != null}
                    onClick={() =>
                      void run('ack', async () => {
                        await onAcknowledge(detail.id, notesForAck)
                        setNote('')
                      })
                    }
                  >
                    {pending === 'ack' ? 'Acknowledging…' : 'Acknowledge'}
                  </button>

                  {detail.status === 'closed' ? (
                    <span className="text-[0.71875rem] font-semibold text-muted">Record closed</span>
                  ) : canClose ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={pending != null}
                      onClick={() =>
                        void run('close', async () => {
                          await onCloseIncident(detail.id, note.trim() || undefined)
                          setNote('')
                        })
                      }
                    >
                      {pending === 'close' ? 'Closing…' : 'Close incident'}
                    </button>
                  ) : (
                    <Tooltip label="Acknowledge this incident before closing it.">
                      <button type="button" className="btn btn-sm" disabled>
                        Close incident
                      </button>
                    </Tooltip>
                  )}

                  {detail.status !== 'closed' ? (
                    <span className="ml-auto">
                      <StatusLabel tone={INCIDENT_TONE[detail.status] ?? 'neutral'}>
                        {detail.status === 'open' ? 'Review needed' : 'Reviewed'}
                      </StatusLabel>
                    </span>
                  ) : null}
                </div>
                {note.trim() && detail.status === 'open' ? (
                  <p className="mt-1.5 text-[0.6875rem] text-muted">
                    The note is included with the acknowledgement if you press Acknowledge now.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New incident"
        subtitle="Create a manual record for later review. It stays open until someone acknowledges it."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setNewOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!summaryValid || pending != null}
              onClick={() =>
                void run('create', async () => {
                  await onNewIncident(trimmedSummary)
                  setSummary('')
                  setNewOpen(false)
                })
              }
            >
              {pending === 'create' ? 'Creating…' : 'Create incident'}
            </button>
          </>
        }
      >
        <label htmlFor="incident-summary" className="label block">
          Summary
        </label>
        <input
          id="incident-summary"
          className="input mt-1.5"
          value={summary}
          maxLength={SUMMARY_MAX}
          placeholder="Short factual description"
          onChange={(event) => setSummary(event.target.value)}
          aria-describedby="incident-summary-help"
        />
        <div id="incident-summary-help" className="mt-1.5 flex justify-between gap-3 text-[0.6875rem] text-muted">
          <span>3 to 200 characters. Plain text; it is stored as written.</span>
          <span className="mono">{summary.length}/{SUMMARY_MAX}</span>
        </div>
      </Dialog>

      <Dialog
        open={inspectionOpen}
        onClose={() => setInspectionOpen(false)}
        title="Request inspection"
        subtitle="Opens an incident and queues an acknowledgement on the device display. Optional notes are kept with the record."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setInspectionOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending != null}
              onClick={() =>
                void run('inspection', async () => {
                  await onRequestInspection(inspectionNotes.trim() || undefined)
                  setInspectionNotes('')
                  setInspectionOpen(false)
                })
              }
            >
              {pending === 'inspection' ? 'Requesting…' : 'Request inspection'}
            </button>
          </>
        }
      >
        <label htmlFor="inspection-notes" className="label block">
          Notes (optional)
        </label>
        <textarea
          id="inspection-notes"
          className="input mt-1.5 min-h-[76px] resize-y"
          value={inspectionNotes}
          maxLength={500}
          placeholder="Where to look and what to check"
          onChange={(event) => setInspectionNotes(event.target.value)}
        />
        <p className="mt-1.5 text-[0.6875rem] text-muted">Up to 500 characters.</p>
      </Dialog>
    </Panel>
  )
}
