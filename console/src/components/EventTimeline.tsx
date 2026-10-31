import { useMemo, useState } from 'react'
import type { EventItem, Incident } from '../api/types'
import { fmtTime, sentence, summarisePayload } from '../lib/format'
import { Panel } from './Panel'

interface EventTimelineProps {
  events: EventItem[]
  incidents: Incident[]
  selectedId: number | null
  onSelectIncident: (id: number) => void
}

export function EventTimeline({ events, incidents, selectedId, onSelectIncident }: EventTimelineProps) {
  const [onlySelected, setOnlySelected] = useState(false)

  const codes = useMemo(() => {
    const map = new Map<number, string>()
    for (const incident of incidents) map.set(incident.id, incident.incident_code)
    return map
  }, [incidents])

  const rows = useMemo(() => {
    const list = [...events].sort((a, b) => b.created_at - a.created_at)
    if (!onlySelected) return list
    if (selectedId == null) return []
    return list.filter((event) => event.incident_id === selectedId)
  }, [events, onlySelected, selectedId])

  return (
    <Panel
      title="Event timeline"
      tour="timeline"
      id="timeline"
      help="Every state change is appended to an audit trail: monitoring, observations, commands and operator actions. Newest first. Filtering by incident shows only the events tied to the record you selected."
      right={
        <label className="inline-flex cursor-pointer items-center gap-2 text-[0.71875rem] text-muted">
          <input
            type="checkbox"
            className="h-[15px] w-[15px] rounded accent-[var(--mint-deep)]"
            checked={onlySelected}
            disabled={selectedId == null}
            onChange={(event) => setOnlySelected(event.target.checked)}
          />
          Selected incident only
        </label>
      }
    >
      {onlySelected && selectedId == null ? (
        <p className="px-4 py-4 text-[0.75rem] text-muted">Select an incident to filter the timeline.</p>
      ) : rows.length ? (
        <div className="p-3 pt-0">
          <div className="max-h-[340px] overflow-auto rounded-xl border" style={{ borderColor: 'var(--hair)' }}>
            <table className="data-table min-w-[620px]">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--panel2)' }}>
                <tr>
                  <th style={{ width: 86 }}>Time</th>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>Record</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr key={event.id}>
                    <td className="mono whitespace-nowrap text-muted">{fmtTime(event.created_at)}</td>
                    <td className="whitespace-nowrap text-[0.71875rem] font-medium">
                      {sentence(String(event.event_type))}
                    </td>
                    <td className="whitespace-nowrap text-muted">{sentence(String(event.actor))}</td>
                    <td className="whitespace-nowrap">
                      {event.incident_id != null ? (
                        <button
                          type="button"
                          className="machine text-[0.71875rem] font-semibold underline-offset-2 hover:underline"
                          style={{ color: 'var(--mint-deep)' }}
                          onClick={() => onSelectIncident(event.incident_id as number)}
                        >
                          {codes.get(event.incident_id) ?? `#${event.incident_id}`}
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td
                      className="machine max-w-[380px] truncate text-[0.6875rem] text-muted"
                      title={summarisePayload(event.payload, 220)}
                    >
                      {summarisePayload(event.payload, 140) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[0.6875rem] text-muted sm:hidden">Swipe the table sideways to see every column.</p>
        </div>
      ) : (
        <p className="px-4 py-4 text-[0.75rem] leading-relaxed text-muted">
          {onlySelected
            ? 'No events are tied to this incident yet.'
            : 'No events yet. Monitoring and operator actions are recorded here as they happen.'}
        </p>
      )}
    </Panel>
  )
}
