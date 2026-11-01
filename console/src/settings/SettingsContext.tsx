import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ViewMode = 'simple' | 'detailed'

interface StoredSettings {
  apiBase: string
  theme: ThemePreference
  themeVersion: number
  textSize: number
  view: ViewMode
  tourDone: boolean
  tourPromptDismissed: boolean
}

const STORAGE_KEY = 'jatayu.console.settings'

const DEFAULTS: StoredSettings = {
  // Served by the backend: same origin. Vite dev server: the local backend.
  apiBase: window.location.port === '5173' ? 'http://localhost:8000' : window.location.origin,
  theme: 'light',
  themeVersion: 1,
  textSize: 2,
  view: 'detailed',
  tourDone: false,
  tourPromptDismissed: false,
}

function loadSettings(): StoredSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<StoredSettings>
    return {
      ...DEFAULTS,
      ...parsed,
      // The instrument palette replaced the old system theme once. Keep later choices as they are.
      theme: parsed.themeVersion === DEFAULTS.themeVersion ? parsed.theme ?? DEFAULTS.theme : DEFAULTS.theme,
      themeVersion: DEFAULTS.themeVersion,
      textSize: typeof parsed.textSize === 'number' ? Math.max(0, Math.min(4, parsed.textSize)) : DEFAULTS.textSize,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

interface SettingsContextValue {
  apiBase: string
  theme: ThemePreference
  dark: boolean
  textSize: number
  view: ViewMode
  tourDone: boolean
  tourPromptDismissed: boolean
  setApiBase: (value: string) => void
  setTheme: (value: ThemePreference) => void
  toggleTheme: () => void
  setTextSize: (value: number) => void
  increaseText: () => void
  decreaseText: () => void
  setView: (value: ViewMode) => void
  completeTour: () => void
  dismissTourPrompt: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StoredSettings>(() => loadSettings())
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* storage may be unavailable; the console still works */
    }
  }, [settings])

  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])

  useEffect(() => {
    document.documentElement.style.fontSize = `${14 + settings.textSize}px`
  }, [settings.textSize])

  const patch = useCallback((changes: Partial<StoredSettings>) => {
    setSettings((current) => ({ ...current, ...changes }))
  }, [])

  const value = useMemo<SettingsContextValue>(
    () => ({
      apiBase: settings.apiBase,
      theme: settings.theme,
      dark,
      textSize: settings.textSize,
      view: settings.view,
      tourDone: settings.tourDone,
      tourPromptDismissed: settings.tourPromptDismissed,
      setApiBase: (apiBase) => patch({ apiBase }),
      setTheme: (theme) => patch({ theme }),
      toggleTheme: () => patch({ theme: dark ? 'light' : 'dark' }),
      setTextSize: (textSize) => patch({ textSize: Math.max(0, Math.min(4, textSize)) }),
      increaseText: () => patch({ textSize: Math.min(4, settings.textSize + 1) }),
      decreaseText: () => patch({ textSize: Math.max(0, settings.textSize - 1) }),
      setView: (view) => patch({ view }),
      completeTour: () => patch({ tourDone: true }),
      dismissTourPrompt: () => patch({ tourPromptDismissed: true }),
    }),
    [settings, dark, patch],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used inside SettingsProvider')
  return context
}
