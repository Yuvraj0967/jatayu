import type { Status } from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export class ApiClient {
  readonly base: string

  constructor(base: string) {
    this.base = base.replace(/\/+$/, '')
  }

  private url(path: string): string {
    return `${this.base}${path}`
  }

  private async request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      })
      if (!response.ok) {
        let detail = `${response.status} ${response.statusText || 'request failed'}`
        try {
          const body = (await response.json()) as { detail?: unknown }
          if (body && typeof body.detail === 'string') detail = body.detail
        } catch {
          /* keep the status line */
        }
        throw new ApiError(detail, response.status)
      }
      if (response.status === 204) return undefined as T
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError('The backend did not answer in time.', 0)
      }
      throw new ApiError('The backend is unreachable.', 0)
    } finally {
      window.clearTimeout(timer)
    }
  }

  get<T>(path: string, timeoutMs = 8000): Promise<T> {
    return this.request<T>(path, { method: 'GET' }, timeoutMs)
  }

  post<T>(path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, timeoutMs)
  }

  put<T>(path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }, timeoutMs)
  }

  probe(): Promise<Status> {
    return this.get<Status>('/api/status', 3000)
  }
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Unknown error.'
}
