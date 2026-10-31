import { useState } from 'react'
import type { NodePatch, NodeRecord } from '../api/types'
import { fmtTime, sentence } from '../lib/format'
import { Panel } from './Panel'

interface NodesTableProps {
  nodes: NodeRecord[]
  onUpdate: (id: string, patch: NodePatch) => Promise<void>
}

interface Draft {
  x_m: string
  y_m: string
  z_m: string
  orientation_deg: string
  antenna: string
}

function draftFrom(node: NodeRecord): Draft {
  return {
    x_m: String(node.x_m),
    y_m: String(node.y_m),
    z_m: String(node.z_m),
    orientation_deg: String(node.orientation_deg),
    antenna: node.antenna ?? '',
  }
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function NodesTable({ nodes, onUpdate }: NodesTableProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  function start(node: NodeRecord) {
    setEditing(node.node_id)
    setDraft(draftFrom(node))
  }

  function cancel() {
    setEditing(null)
    setDraft(null)
  }

  async function save(node: NodeRecord) {
    if (!draft) return
    const heading = Math.round(toNumber(draft.orientation_deg, node.orientation_deg))
    const patch: NodePatch = {
      x_m: toNumber(draft.x_m, node.x_m),
      y_m: toNumber(draft.y_m, node.y_m),
      z_m: toNumber(draft.z_m, node.z_m),
      orientation_deg: ((heading % 360) + 360) % 360,
      antenna: draft.antenna.trim() || node.antenna,
      notes: node.notes,
      role: node.role,
    }
    setPending(node.node_id)
    try {
      await onUpdate(node.node_id, patch)
      cancel()
    } catch {
      /* the calling layer surfaces the error as a toast */
    } finally {
      setPending(null)
    }
  }

  function field(key: keyof Draft, value: string) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  return (
    <Panel
      title="Sensor nodes"
      id="nodes-panel"
      help="Positions are metres from the site origin you chose during setup. Heading is degrees clockwise from the entry direction. These values label the evidence; they do not change how the RF pattern is judged."
    >
      {nodes.length ? (
        <div className="p-3 pt-0">
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--hair)' }}>
            <table className="data-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Role</th>
                  <th className="text-right">x m</th>
                  <th className="text-right">y m</th>
                  <th className="text-right">z m</th>
                  <th className="text-right">Heading</th>
                  <th>Antenna</th>
                  <th>Last seen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => {
                  const isEditing = editing === node.node_id
                  const busy = pending === node.node_id
                  return (
                    <tr key={node.node_id}>
                      <td>
                        <span className="machine text-[0.71875rem] font-semibold">{node.node_id}</span>
                        <span className="machine block text-[0.625rem] text-muted">{node.firmware}</span>
                      </td>
                      <td>{sentence(node.role)}</td>
                      {(['x_m', 'y_m', 'z_m'] as const).map((key) => (
                        <td key={key} className="text-right">
                          {isEditing && draft ? (
                            <input
                              className="input mono"
                              style={{ width: 64, padding: '4px 6px', textAlign: 'right' }}
                              inputMode="decimal"
                              value={draft[key]}
                              aria-label={`${node.node_id} ${key.replace('_m', '')} metres`}
                              onChange={(event) => field(key, event.target.value)}
                            />
                          ) : (
                            <span className="mono">{node[key]}</span>
                          )}
                        </td>
                      ))}
                      <td className="text-right">
                        {isEditing && draft ? (
                          <input
                            className="input mono"
                            style={{ width: 62, padding: '4px 6px', textAlign: 'right' }}
                            inputMode="numeric"
                            value={draft.orientation_deg}
                            aria-label={`${node.node_id} heading in degrees`}
                            onChange={(event) => field('orientation_deg', event.target.value)}
                          />
                        ) : (
                          <span className="mono">{node.orientation_deg}°</span>
                        )}
                      </td>
                      <td>
                        {isEditing && draft ? (
                          <input
                            className="input"
                            style={{ width: 130, padding: '4px 8px' }}
                            value={draft.antenna}
                            aria-label={`${node.node_id} antenna`}
                            onChange={(event) => field('antenna', event.target.value)}
                          />
                        ) : (
                          <span>{node.antenna || '—'}</span>
                        )}
                      </td>
                      <td className="mono whitespace-nowrap text-muted">{fmtTime(node.last_seen_at)}</td>
                      <td className="whitespace-nowrap text-right">
                        {isEditing ? (
                          <span className="inline-flex gap-1">
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => void save(node)} disabled={busy}>
                              {busy ? 'Saving…' : 'Save'}
                            </button>
                            <button type="button" className="btn btn-sm btn-quiet" onClick={cancel} disabled={busy}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="btn btn-sm btn-quiet" onClick={() => start(node)}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[0.6875rem] text-muted sm:hidden">Swipe the table sideways to see every column.</p>
        </div>
      ) : (
        <p className="px-4 py-4 text-[0.75rem] leading-relaxed text-muted">
          No sensor nodes registered yet. A node appears after the backend sees its first packet.
        </p>
      )}
    </Panel>
  )
}
