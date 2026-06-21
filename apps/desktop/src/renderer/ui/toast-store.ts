export type ToastTone = 'success' | 'info' | 'warning' | 'error'

export interface ToastMessage {
  readonly id: string
  readonly tone: ToastTone
  readonly message: string
}

interface ToastInput {
  readonly tone: ToastTone
  readonly message: string
  readonly durationMs?: number | undefined
}

const DEFAULT_DURATION_MS = 4000
const MAX_TOASTS = 3

let nextToastId = 0
let toasts: readonly ToastMessage[] = []
const listeners = new Set<() => void>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function emit() {
  for (const listener of listeners) listener()
}

export function getToasts(): readonly ToastMessage[] {
  return toasts
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function dismissToast(id: string): void {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  const next = toasts.filter((toastMessage) => toastMessage.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  toasts = []
  emit()
}

export function showToast(input: ToastInput): string {
  const id = `toast-${++nextToastId}`
  const next = [...toasts, { id, tone: input.tone, message: input.message }].slice(-MAX_TOASTS)
  for (const removed of toasts) {
    if (!next.some((toastMessage) => toastMessage.id === removed.id)) {
      const timer = timers.get(removed.id)
      if (timer) clearTimeout(timer)
      timers.delete(removed.id)
    }
  }
  toasts = next
  const durationMs = input.durationMs ?? DEFAULT_DURATION_MS
  if (durationMs > 0) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), durationMs),
    )
  }
  emit()
  return id
}

export const toast = {
  success: (message: string, durationMs?: number) =>
    showToast({ tone: 'success', message, durationMs }),
  info: (message: string, durationMs?: number) => showToast({ tone: 'info', message, durationMs }),
  warning: (message: string, durationMs?: number) =>
    showToast({ tone: 'warning', message, durationMs }),
  error: (message: string, durationMs?: number) => showToast({ tone: 'error', message, durationMs }),
}
