import type { PhotoItem } from '@/types'
import type { Decision } from '../policy/classify'

/** dHash groups are similarity candidates, not human-confirmed bursts. */
export function preserveSurvivors(items: PhotoItem[], decisions: Map<string, Decision>): void {
  const groups = new Map<string, PhotoItem[]>()
  for (const item of items) {
    const id = (item as any).burstId as string | undefined
    if (!id) continue
    const group = groups.get(id) || []; group.push(item); groups.set(id, group)
  }
  for (const group of groups.values()) {
    if (group.length < 2 || group.some(i => decisions.get(i.id)?.category !== 'rejects')) continue
    const best = group.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
    const decision = decisions.get(best.id)!
    decision.category = 'maybe'; decision.reasonCodes.push('BURST_SURVIVOR')
    decision.reasons.push('Kandidat terbaik grup — perlu review')
    decision.reasonsEn.push('Best group candidate — needs review')
  }
}
