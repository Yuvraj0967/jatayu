import type { Command } from '../api/types'
import { fmtTime } from '../lib/format'
import { COMMAND_TONE, commandLabel } from '../lib/rf'
import { Panel } from './Panel'
import { StatusLabel } from './StatusLabel'

interface CommandsTableProps {
  commands: Command[]
}

export function CommandsTable({ commands }: CommandsTableProps) {
  return (
    <Panel
      title="Device commands"
      id="commands-panel"
      help="Commands are queued by the backend and sent to the Arduino over serial. The stage shows how far each one got. Sent does not mean executed; only acknowledged confirms the device finished the action."
    >
      {commands.length ? (
        <div className="p-3 pt-0">
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--hair)' }}>
            <table className="data-table min-w-[700px]">
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Target</th>
                  <th>Stage</th>
                  <th>Created</th>
                  <th>Last step</th>
                  <th>Failure</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((command) => {
                  const last =
                    command.acknowledged_at ??
                    command.executed_at ??
                    command.received_at ??
                    command.sent_at ??
                    command.created_at
                  return (
                    <tr key={command.id}>
                      <td>
                        <span className="text-[0.75rem] font-semibold">{String(command.name)}</span>
                        <span className="machine mt-0.5 block text-[0.625rem] text-muted">{command.id}</span>
                      </td>
                      <td className="machine text-[0.71875rem]">{String(command.target)}</td>
                      <td>
                        <StatusLabel tone={COMMAND_TONE[command.state] ?? 'neutral'}>
                          {commandLabel(command.state)}
                        </StatusLabel>
                      </td>
                      <td className="mono whitespace-nowrap text-muted">{fmtTime(command.created_at)}</td>
                      <td className="mono whitespace-nowrap text-muted">{fmtTime(last)}</td>
                      <td className="max-w-[220px] break-words text-muted">
                        {command.failure ? String(command.failure) : '—'}
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
          No device commands yet. Requesting an inspection queues one, and the stage updates as the Arduino replies.
        </p>
      )}
    </Panel>
  )
}
