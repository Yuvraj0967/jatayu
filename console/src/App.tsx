import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from './api/client'
import { useJatayuFeed } from './api/useJatayu'
import { CommandsTable } from './components/CommandsTable'
import { EnvironmentPanel } from './components/EnvironmentPanel'
import { EventTimeline } from './components/EventTimeline'
import { HelpDialog } from './components/HelpDialog'
import { IncidentsPanel } from './components/IncidentsPanel'
import { KeypadEffects } from './components/KeypadEffects'
import { LimitsBanner } from './components/LimitsBanner'
import { NextAction } from './components/NextAction'
import { NodesTable } from './components/NodesTable'
import { ReadoutStrip } from './components/ReadoutStrip'
import { RFPanel } from './components/RFPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { SetupChecklist } from './components/SetupChecklist'
import { SignalLab } from './components/SignalLab'
import { ToastProvider, useToast } from './components/Toast'
import { Toolbar } from './components/Toolbar'
import { TopBar } from './components/TopBar'
import { Tour } from './components/Tour'
import { TourPrompt } from './components/TourPrompt'
import { nextAction, type NextActionKind } from './lib/guide'
import { secondsSince } from './lib/format'
import { SettingsProvider, useSettings } from './settings/SettingsContext'

type Tab = 'overview' | 'signal-lab'

function OverviewApp() {
  const settings = useSettings()
  const toast = useToast()
  const feed = useJatayuFeed(settings.apiBase)
  const { status, mode, feedState, lastStatusAt, incidents, events, commands, nodes, rfHistory, envHistory } = feed

  const [tab, setTab] = useState<Tab>('overview')
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)

  const feedRef = useRef(feed)
  feedRef.current = feed
  const incidentsRef = useRef(incidents)
  incidentsRef.current = incidents
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const ageS = lastStatusAt == null ? Number.POSITIVE_INFINITY : secondsSince(lastStatusAt, now)
  const stale = mode === 'live' && ageS > 6
  const openIncidents = incidents.filter((incident) => incident.status === 'open').length
  const ageLabel = lastStatusAt == null ? 'no update yet' : `updated ${Math.max(0, Math.round(ageS))} s ago`

  const action = nextAction({
    apiReachable: mode !== 'demo',
    mode,
    lastUpdateAgeS: Number.isFinite(ageS) ? ageS : 999,
    source: status?.source ?? null,
    monitoring: Boolean(status?.monitoring),
    esp32Online: status?.devices?.esp32 === 'online',
    arduinoOnline: status?.devices?.arduino === 'online',
    openIncidents,
    gasStatus: status?.environment.status ?? 'NO_DATA',
    gasWarmupRemainingS: status?.environment.warmup_remaining_s ?? null,
    rfState: status?.rf.state ?? 'NO_DATA',
    apiBase: settings.apiBase,
  })

  const act = useCallback(
    async <T,>(key: string, work: () => Promise<T>, success?: { title: string; message?: string }): Promise<T> => {
      setBusy(key)
      try {
        const result = await work()
        if (success) toast({ tone: 'good', title: success.title, message: success.message })
        return result
      } catch (error) {
        toast({ tone: 'critical', title: 'Action failed', message: describeError(error) })
        throw error
      } finally {
        setBusy(null)
      }
    },
    [toast],
  )

  const toggleMonitoring = useCallback(() => {
    const current = feedRef.current
    const monitoring = Boolean(current.status?.monitoring)
    if (monitoring) {
      void act(
        'monitor',
        () => current.stopMonitoring(),
        {
          title: 'Monitoring stopped',
          message: 'Incidents will not open while monitoring is off. Existing records are unchanged.',
        },
      ).catch(() => {})
    } else {
      void act(
        'monitor',
        () => current.startMonitoring(),
        {
          title: 'Monitoring started',
          message: 'Notable observations will now open incidents for review.',
        },
      ).catch(() => {})
    }
  }, [act])

  const openIncidentsPanel = useCallback(() => {
    setTab('overview')
    const list = incidentsRef.current
    const target = list.find((incident) => incident.status === 'open') ?? list[0]
    if (target) feedRef.current.selectIncident(target.id)
    window.setTimeout(() => {
      document.getElementById('incidents-panel')?.scrollIntoView({ block: 'center', behavior: 'auto' })
    }, 80)
  }, [])

  const onAction = useCallback(
    (kind: NextActionKind) => {
      if (kind === 'retry') {
        feedRef.current.retry()
        toast({ tone: 'neutral', title: 'Checking the backend', message: `Trying ${settingsRef.current.apiBase} again.` })
        return
      }
      if (kind === 'start') {
        toggleMonitoring()
        return
      }
      if (kind === 'incidents') {
        openIncidentsPanel()
        return
      }
      if (kind === 'signal-lab') {
        setTab('signal-lab')
      }
    },
    [openIncidentsPanel, toast, toggleMonitoring],
  )

  const saveApiBase = useCallback(
    (apiBase: string) => {
      settings.setApiBase(apiBase)
      toast({
        tone: 'neutral',
        title: 'API address saved',
        message: `Reconnecting to ${apiBase}. If it does not answer in three seconds, the console falls back to demo data.`,
      })
    },
    [settings, toast],
  )

  const finishTour = useCallback(() => {
    settings.completeTour()
    setTourOpen(false)
  }, [settings])

  const startTour = useCallback(() => setTourOpen(true), [])
  const showOverview = useCallback(() => setTab('overview'), [])

  return (
    <div className="min-h-screen">
      <TopBar
        feedState={feedState}
        source={status?.source ?? null}
        updatedAt={lastStatusAt}
        monitoring={Boolean(status?.monitoring)}
        busy={busy === 'monitor'}
        dark={settings.dark}
        onToggleMonitoring={toggleMonitoring}
        onToggleTheme={settings.toggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="mx-auto w-full max-w-page px-3 pb-12 pt-3 sm:px-6">
        <div className="utility-row">
          <LimitsBanner />
          {!settings.tourDone && !settings.tourPromptDismissed ? (
            <TourPrompt onStart={startTour} onDismiss={settings.dismissTourPrompt} />
          ) : null}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <NextAction result={action} onAction={onAction} />
          <SetupChecklist mode={mode} status={status} />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Console sections" role="tablist" className="seg">
            {(
              [
                { id: 'overview', label: 'Overview' },
                { id: 'signal-lab', label: 'Signal lab' },
              ] as const
            ).map((entry) => {
              const selected = tab === entry.id
              return (
                <button
                  key={entry.id}
                  id={`tab-${entry.id}`}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  aria-controls={`panel-${entry.id}`}
                  data-tour={entry.id === 'signal-lab' ? 'signal-lab-tab' : 'overview-tab'}
                  onClick={() => setTab(entry.id)}
                  className="px-3.5 py-1.5 text-[0.75rem]"
                >
                  {entry.label}
                </button>
              )
            })}
          </nav>
          <Toolbar
            view={settings.view}
            textSize={settings.textSize}
            onViewChange={settings.setView}
            onTextSmaller={settings.decreaseText}
            onTextLarger={settings.increaseText}
            onStartTour={startTour}
            onOpenHelp={() => setHelpOpen(true)}
          />
        </div>

        <div className="mt-4">
          {tab === 'overview' ? (
            <section
              id="panel-overview"
              role="tabpanel"
              aria-labelledby="tab-overview"
              className="sheet"
            >
              <ReadoutStrip status={status} mode={mode} lastStatusAt={lastStatusAt} now={now} />

              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="flex min-w-0 flex-col gap-4">
                  <RFPanel
                    rf={status?.rf ?? null}
                    history={rfHistory}
                    simple={settings.view === 'simple'}
                    stale={stale}
                    ageLabel={ageLabel}
                  />
                  <EnvironmentPanel
                    environment={status?.environment ?? null}
                    history={envHistory}
                    simple={settings.view === 'simple'}
                    busy={busy != null}
                    onRebaseline={() =>
                      void act(
                        'baseline',
                        () => feedRef.current.rebaseline(),
                        {
                          title: 'Re-baseline requested',
                          message: 'Clean-air readings will set the new reference. The elevated threshold is unchanged.',
                        },
                      ).catch(() => {})
                    }
                  />
                </div>

                <div className="flex min-w-0 flex-col">
                  <IncidentsPanel
                    className="h-full"
                    incidents={incidents}
                    selectedId={feed.selectedId}
                    detail={feed.detail}
                    detailLoading={feed.detailLoading}
                    onSelect={feed.selectIncident}
                    onNewIncident={async (summary) => {
                      const incident = await act(
                        'incident',
                        () => feedRef.current.createIncident(summary),
                        {
                          title: 'Incident created',
                          message: 'The record is open and waiting for review.',
                        },
                      )
                      feedRef.current.selectIncident(incident.id)
                    }}
                    onRequestInspection={async (notes) => {
                      const result = await act(
                        'inspection',
                        () => feedRef.current.requestInspection(notes),
                        {
                          title: 'Inspection requested',
                          message: 'A new incident was opened and a command was queued for the device display.',
                        },
                      )
                      feedRef.current.selectIncident(result.incident_id)
                    }}
                    onAddNote={async (id, text) => {
                      await act('note', () => feedRef.current.addNote(id, text), {
                        title: 'Note added',
                        message: 'The note is part of the audit record.',
                      })
                    }}
                    onAcknowledge={async (id, notes) => {
                      await act('acknowledge', () => feedRef.current.acknowledge(id, notes), {
                        title: 'Incident acknowledged',
                        message: 'The incident can now be closed once you are finished.',
                      })
                    }}
                    onCloseIncident={async (id, notes) => {
                      await act('close', () => feedRef.current.closeIncident(id, notes), {
                        title: 'Incident closed',
                        message: 'The record remains in the event timeline.',
                      })
                    }}
                  />
                </div>
              </div>

              <EventTimeline
                events={events}
                incidents={incidents}
                selectedId={feed.selectedId}
                onSelectIncident={feed.selectIncident}
              />

              {settings.view === 'detailed' ? (
                <>
                  <CommandsTable commands={commands} />
                  <NodesTable
                    nodes={nodes}
                    onUpdate={async (id, patch) => {
                      await act('node', () => feedRef.current.updateNode(id, patch), {
                        title: 'Node position updated',
                        message: 'The new placement is used to label future evidence.',
                      })
                    }}
                  />
                </>
              ) : null}
            </section>
          ) : (
            <section id="panel-signal-lab" role="tabpanel" aria-labelledby="tab-signal-lab" className="sheet">
              <SignalLab
                apiBase={settings.apiBase}
                demo={mode === 'demo'}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </section>
          )}
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        apiBase={settings.apiBase}
        mode={mode}
        theme={settings.theme}
        onClose={() => setSettingsOpen(false)}
        onSave={saveApiBase}
        onTheme={settings.setTheme}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Tour open={tourOpen} onFinish={finishTour} onTab={setTab} />
      <KeypadEffects status={status} apiBase={settings.apiBase} onShowOverview={showOverview} />
    </div>
  )
}

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <OverviewApp />
      </ToastProvider>
    </SettingsProvider>
  )
}
