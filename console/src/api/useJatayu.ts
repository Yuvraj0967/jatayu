import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiClient, ApiError, describeError } from './client'
import { DemoEngine } from './demo'
import type {
  Command,
  EventItem,
  Incident,
  IncidentDetail,
  InspectionResult,
  Mode,
  NodePatch,
  NodeRecord,
  Reading,
  RfHistoryPoint,
  Status,
} from './types'

export type FeedIndicator = 'connecting' | 'live' | 'polling' | 'lost' | 'demo'

export interface JatayuFeed {
  mode: Mode
  feedState: FeedIndicator
  status: Status | null
  lastStatusAt: number | null
  incidents: Incident[]
  events: EventItem[]
  commands: Command[]
  nodes: NodeRecord[]
  rfHistory: RfHistoryPoint[]
  envHistory: Reading[]
  selectedId: number | null
  detail: IncidentDetail | null
  detailLoading: boolean
  error: string | null
  selectIncident: (id: number | null) => void
  retry: () => void
  startMonitoring: () => Promise<void>
  stopMonitoring: () => Promise<void>
  requestInspection: (notes?: string) => Promise<InspectionResult>
  createIncident: (summary: string) => Promise<Incident>
  addNote: (id: number, text: string) => Promise<void>
  acknowledge: (id: number, notes?: string) => Promise<void>
  closeIncident: (id: number, notes?: string) => Promise<void>
  rebaseline: () => Promise<void>
  updateNode: (id: string, patch: NodePatch) => Promise<void>
  simulateKey: (key: string) => Promise<void>
  simulateGas: (offset: number) => Promise<void>
}

export function useJatayuFeed(apiBase: string): JatayuFeed {
  const [mode, setMode] = useState<Mode>('connecting')
  const [feedState, setFeedState] = useState<FeedIndicator>('connecting')
  const [status, setStatus] = useState<Status | null>(null)
  const [lastStatusAt, setLastStatusAt] = useState<number | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [commands, setCommands] = useState<Command[]>([])
  const [nodes, setNodes] = useState<NodeRecord[]>([])
  const [rfHistory, setRfHistory] = useState<RfHistoryPoint[]>([])
  const [envHistory, setEnvHistory] = useState<Reading[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<IncidentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  const modeRef = useRef<Mode>('connecting')
  const clientRef = useRef<ApiClient>(new ApiClient(apiBase))
  const demoRef = useRef<DemoEngine | null>(null)
  const selectedRef = useRef<number | null>(null)

  const refreshStatusRef = useRef<() => Promise<void>>(async () => {})
  const refreshListsRef = useRef<() => Promise<void>>(async () => {})
  const refreshDetailRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])

  const selectIncident = useCallback((id: number | null) => {
    setSelectedId(id)
    selectedRef.current = id
    if (id == null) {
      setDetail(null)
      return
    }
    if (modeRef.current === 'demo') {
      setDetail(demoRef.current?.getDetail(id) ?? null)
      return
    }
    setDetailLoading(true)
    clientRef.current
      .get<IncidentDetail>(`/api/incidents/${id}`)
      .then((next) => {
        if (selectedRef.current === id) setDetail(next)
      })
      .catch(() => {
        if (selectedRef.current === id) setDetail(null)
      })
      .finally(() => setDetailLoading(false))
  }, [])

  useEffect(() => {
    let cancelled = false
    const client = new ApiClient(apiBase)
    clientRef.current = client
    let demo: DemoEngine | null = null
    let ws: WebSocket | null = null
    let wsClosedByUs = false
    let wsOpened = false
    let reconnectTimer: number | null = null
    let statusTimer: number | null = null
    let listsTimer: number | null = null
    let wsBackoff = 1000
    let unsubscribe: (() => void) | null = null

    setMode('connecting')
    modeRef.current = 'connecting'
    setFeedState('connecting')
    setStatus(null)
    setLastStatusAt(null)
    setIncidents([])
    setEvents([])
    setCommands([])
    setNodes([])
    setRfHistory([])
    setEnvHistory([])
    setDetail(null)
    setSelectedId(null)
    selectedRef.current = null
    setError(null)

    function applyDemo() {
      if (!demo) return
      const snapshot = demo.snapshot()
      setStatus(snapshot.status)
      setLastStatusAt(Date.now())
      setIncidents(snapshot.incidents)
      setEvents(snapshot.events)
      setCommands(snapshot.commands)
      setNodes(snapshot.nodes)
      setRfHistory(snapshot.rfHistory)
      setEnvHistory(snapshot.envHistory)
      const id = selectedRef.current
      if (id != null) setDetail(demo.getDetail(id))
    }

    async function loadStatus() {
      try {
        const snapshot = await client.probe()
        if (cancelled) return
        setStatus(snapshot)
        setLastStatusAt(Date.now())
        setError(null)
        if (!wsOpened) setFeedState('polling')
      } catch (cause) {
        if (cancelled) return
        setError(describeError(cause))
        if (!wsOpened) setFeedState('lost')
      }
    }

    async function loadLists() {
      const settle = <T,>(promise: Promise<T>) => promise.catch(() => null)
      const [inc, evt, cmd, nod, rf, env] = await Promise.all([
        settle(client.get<Incident[]>('/api/incidents?limit=60')),
        settle(client.get<EventItem[]>('/api/events?limit=120')),
        settle(client.get<Command[]>('/api/commands')),
        settle(client.get<NodeRecord[]>('/api/nodes')),
        settle(client.get<RfHistoryPoint[]>('/api/rf/history?limit=240')),
        settle(client.get<Reading[]>('/api/sensors/history?sensor=mq_raw&limit=300')),
      ])
      if (cancelled) return
      if (inc) setIncidents(inc)
      if (evt) setEvents(evt)
      if (cmd) setCommands(cmd)
      if (nod) setNodes(nod)
      if (rf) setRfHistory(rf)
      if (env) setEnvHistory(env)
    }

    function scheduleReconnect() {
      if (cancelled || reconnectTimer != null) return
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        if (!cancelled) connectWs()
      }, wsBackoff)
      wsBackoff = Math.min(15000, wsBackoff * 2)
    }

    function connectWs() {
      if (cancelled) return
      const url = `${client.base.replace(/^http/, 'ws')}/ws/live`
      try {
        ws = new WebSocket(url)
      } catch {
        setFeedState('lost')
        scheduleReconnect()
        return
      }
      ws.onopen = () => {
        if (cancelled) return
        wsOpened = true
        wsBackoff = 1000
        setFeedState('live')
        setError(null)
      }
      ws.onmessage = (message) => {
        if (cancelled) return
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(String(message.data)) as Record<string, unknown>
        } catch {
          return
        }
        if (payload.type === 'jatayu') {
          setStatus(payload as unknown as Status)
          setLastStatusAt(Date.now())
        } else if (payload.type === 'event' && payload.event) {
          const event = payload.event as EventItem
          setEvents((previous) => {
            if (previous.some((entry) => entry.id === event.id)) return previous
            return [event, ...previous].slice(0, 120)
          })
          void loadLists()
        } else if (payload.type === 'key' && payload.key) {
          setStatus((previous) => (previous ? { ...previous, last_key: payload.key as Status['last_key'] } : previous))
        }
      }
      ws.onclose = () => {
        if (cancelled || wsClosedByUs) return
        wsOpened = false
        setFeedState('lost')
        scheduleReconnect()
      }
      ws.onerror = () => {
        try {
          ws?.close()
        } catch {
          /* ignore */
        }
      }
    }

    function startLive() {
      void loadLists()
      void loadStatus()
      statusTimer = window.setInterval(loadStatus, 5000)
      listsTimer = window.setInterval(loadLists, 4000)
      connectWs()
    }

    async function boot() {
      try {
        const snapshot = await client.probe()
        if (cancelled) return
        setStatus(snapshot)
        setLastStatusAt(Date.now())
        setMode('live')
        modeRef.current = 'live'
        setFeedState('polling')
        startLive()
      } catch {
        if (cancelled) return
        demo = new DemoEngine()
        demoRef.current = demo
        unsubscribe = demo.subscribe(() => {
          if (!cancelled) applyDemo()
        })
        demo.start()
        applyDemo()
        setMode('demo')
        modeRef.current = 'demo'
        setFeedState('demo')
      }
    }

    refreshStatusRef.current = loadStatus
    refreshListsRef.current = loadLists
    refreshDetailRef.current = async () => {
      const id = selectedRef.current
      if (id == null) return
      if (modeRef.current === 'demo') {
        setDetail(demoRef.current?.getDetail(id) ?? null)
        return
      }
      try {
        const next = await client.get<IncidentDetail>(`/api/incidents/${id}`)
        if (!cancelled && selectedRef.current === id) setDetail(next)
      } catch {
        /* keep the previous detail */
      }
    }

    void boot()

    return () => {
      cancelled = true
      wsClosedByUs = true
      if (ws) {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer)
      if (statusTimer != null) window.clearInterval(statusTimer)
      if (listsTimer != null) window.clearInterval(listsTimer)
      unsubscribe?.()
      demo?.stop()
      demoRef.current = null
    }
  }, [apiBase, retryNonce])

  const retry = useCallback(() => {
    setRetryNonce((value) => value + 1)
  }, [])

  const runLive = useCallback(async <T,>(live: (client: ApiClient) => Promise<T>, local: (demo: DemoEngine) => Promise<T>) => {
    if (modeRef.current === 'demo' && demoRef.current) return local(demoRef.current)
    if (modeRef.current !== 'live') throw new ApiError('The console is still connecting to the backend.')
    return live(clientRef.current)
  }, [])

  const startMonitoring = useCallback(async () => {
    await runLive(
      (client) => client.post('/api/monitoring/start'),
      (demo) => demo.startMonitoring(),
    )
    if (modeRef.current === 'live') {
      void refreshStatusRef.current()
      void refreshListsRef.current()
    }
  }, [runLive])

  const stopMonitoring = useCallback(async () => {
    await runLive(
      (client) => client.post('/api/monitoring/stop'),
      (demo) => demo.stopMonitoring(),
    )
    if (modeRef.current === 'live') {
      void refreshStatusRef.current()
      void refreshListsRef.current()
    }
  }, [runLive])

  const requestInspection = useCallback(
    async (notes?: string) => {
      const result = await runLive(
        (client) => client.post<InspectionResult>('/api/inspection/request', { notes }),
        (demo) => demo.requestInspection(notes),
      )
      if (modeRef.current === 'live') {
        void refreshListsRef.current()
        void refreshStatusRef.current()
      }
      return result
    },
    [runLive],
  )

  const createIncident = useCallback(
    async (summary: string) => {
      const incident = await runLive(
        (client) => client.post<Incident>('/api/incidents', { summary }),
        (demo) => demo.createIncident(summary),
      )
      if (modeRef.current === 'live') void refreshListsRef.current()
      return incident
    },
    [runLive],
  )

  const addNote = useCallback(
    async (id: number, text: string) => {
      await runLive(
        (client) => client.post(`/api/incidents/${id}/notes`, { text }),
        (demo) => demo.addNote(id, text),
      )
      if (modeRef.current === 'live') {
        void refreshDetailRef.current()
        void refreshListsRef.current()
      }
    },
    [runLive],
  )

  const acknowledge = useCallback(
    async (id: number, notes?: string) => {
      await runLive(
        (client) => client.post(`/api/incidents/${id}/acknowledge`, { notes }),
        (demo) => demo.acknowledge(id, notes),
      )
      if (modeRef.current === 'live') {
        void refreshDetailRef.current()
        void refreshListsRef.current()
      }
    },
    [runLive],
  )

  const closeIncident = useCallback(
    async (id: number, notes?: string) => {
      await runLive(
        (client) => client.post(`/api/incidents/${id}/close`, { notes }),
        (demo) => demo.closeIncident(id, notes),
      )
      if (modeRef.current === 'live') {
        void refreshDetailRef.current()
        void refreshListsRef.current()
      }
    },
    [runLive],
  )

  const rebaseline = useCallback(async () => {
    await runLive(
      (client) => client.post('/api/sensors/rebaseline'),
      (demo) => demo.rebaseline(),
    )
    if (modeRef.current === 'live') void refreshStatusRef.current()
  }, [runLive])

  const updateNode = useCallback(
    async (id: string, patch: NodePatch) => {
      await runLive(
        (client) => client.put(`/api/nodes/${encodeURIComponent(id)}`, patch),
        (demo) => demo.updateNode(id, patch),
      )
      if (modeRef.current === 'live') void refreshListsRef.current()
    },
    [runLive],
  )

  const simulateKey = useCallback(
    async (key: string) => {
      await runLive(
        (client) => client.post('/api/simulate/key', { key }),
        (demo) => demo.simulateKey(key),
      )
      if (modeRef.current === 'live') {
        void refreshStatusRef.current()
        void refreshListsRef.current()
      }
    },
    [runLive],
  )

  const simulateGas = useCallback(
    async (offset: number) => {
      await runLive(
        (client) => client.post('/api/simulate/gas', { offset }),
        (demo) => demo.simulateGas(offset),
      )
      if (modeRef.current === 'live') void refreshStatusRef.current()
    },
    [runLive],
  )

  useEffect(() => {
    if (selectedRef.current != null) return
    if (!incidents.length) return
    const next = incidents.find((incident) => incident.status === 'open') ?? incidents[0]
    selectIncident(next.id)
  }, [incidents, selectIncident])

  return {
    mode,
    feedState,
    status,
    lastStatusAt,
    incidents,
    events,
    commands,
    nodes,
    rfHistory,
    envHistory,
    selectedId,
    detail,
    detailLoading,
    error,
    selectIncident,
    retry,
    startMonitoring,
    stopMonitoring,
    requestInspection,
    createIncident,
    addNote,
    acknowledge,
    closeIncident,
    rebaseline,
    updateNode,
    simulateKey,
    simulateGas,
  }
}
