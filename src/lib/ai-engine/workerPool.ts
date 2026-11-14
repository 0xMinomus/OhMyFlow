import type { Sensitivity } from '@/types'
import type { AnalyzedPhotoOutput } from './analyze-photo'
import type { WorkerRequest, WorkerResponse } from './cull.worker'

interface PendingJob {
  id: number
  req: WorkerRequest
  resolve: (val: AnalyzedPhotoOutput | null) => void
}

interface WorkerSlot {
  worker: Worker
  busy: boolean
  currentJob: PendingJob | null
}

export interface CullWorkerPool {
  analyze: (src: string, mode: Sensitivity, analysisSize: number) => Promise<AnalyzedPhotoOutput | null>
  dispose: () => void
}

export function createCullWorkerPool(fallback: (src: string, mode: Sensitivity, analysisSize: number) => Promise<AnalyzedPhotoOutput | null>): CullWorkerPool {
  const canWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function'
  if (!canWorker) {
    return {
      analyze: fallback,
      dispose: () => {},
    }
  }

  const baseUrl = typeof document !== 'undefined' ? document.baseURI : ''
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 2) : 2
  const count = cores >= 4 ? 2 : 1
  const slots: WorkerSlot[] = []
  const queue: PendingJob[] = []
  let nextId = 1
  let dead = false
  let workerBroken = false

  function pump() {
    if (dead || workerBroken) return
    for (const slot of slots) {
      if (slot.busy || queue.length === 0) continue
      const job = queue.shift()!
      slot.busy = true
      slot.currentJob = job
      slot.worker.postMessage(job.req)
    }
  }

  function handleFailure() {
    workerBroken = true
    for (const slot of slots) {
      if (slot.currentJob) {
        const j = slot.currentJob
        slot.currentJob = null
        slot.busy = false
        fallback(j.req.src, j.req.mode, j.req.analysisSize).then(j.resolve, () => j.resolve(null))
      }
      try { slot.worker.terminate() } catch {}
    }
    slots.length = 0
    while (queue.length) {
      const j = queue.shift()!
      fallback(j.req.src, j.req.mode, j.req.analysisSize).then(j.resolve, () => j.resolve(null))
    }
  }

  try {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./cull.worker.ts', import.meta.url), { type: 'module' })
      const slot: WorkerSlot = { worker, busy: false, currentJob: null }
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const job = slot.currentJob
        slot.currentJob = null
        slot.busy = false
        if (job) job.resolve(ev.data?.ok ? ev.data.result : null)
        pump()
      }
      worker.onerror = () => {
        handleFailure()
      }
      slots.push(slot)
    }
  } catch {
    handleFailure()
  }

  return {
    analyze(src: string, mode: Sensitivity, analysisSize: number): Promise<AnalyzedPhotoOutput | null> {
      if (dead || workerBroken || slots.length === 0) {
        return fallback(src, mode, analysisSize)
      }
      return new Promise<AnalyzedPhotoOutput | null>((resolve) => {
        const id = nextId++
        queue.push({
          id,
          req: { id, src, mode, analysisSize, baseUrl },
          resolve,
        })
        pump()
      })
    },
    dispose() {
      dead = true
      for (const slot of slots) {
        if (slot.currentJob) {
          slot.currentJob.resolve(null)
          slot.currentJob = null
        }
        try { slot.worker.terminate() } catch {}
      }
      slots.length = 0
      while (queue.length) {
        queue.shift()!.resolve(null)
      }
    },
  }
}
