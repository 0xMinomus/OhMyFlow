export type SignalStatus = 'ok' | 'unknown' | 'unavailable' | 'error'
export interface Metric<T> {
  value: T | null
  confidence: number | null
  status: SignalStatus
  source: string
}
export type EyeState = 'open' | 'closed' | 'squint' | 'unknown'
export interface EyeResult { left: Metric<EyeState>; right: Metric<EyeState> }
