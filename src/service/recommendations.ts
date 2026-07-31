import { useAppStore } from '@/store/app.store'

// Personalized home rows (backend Docs/RECOMMENDER.md section 4). Only ids
// travel; callers hydrate through getSong. The nonce defeats the zone's
// cache-everything rule — this response is per-user and must never be served
// from the edge.
export interface RecommendationRow {
  surface: string
  title: string | null
  track_ids: string[]
}

export async function getHomeRows(): Promise<RecommendationRow[]> {
  const { url, tlmcAuth } = useAppStore.getState().data
  if (!tlmcAuth) return []

  const response = await fetch(
    `${url}/api/music/recommendations/home?nonce=${Date.now()}`,
    { headers: { 'X-Api-Key': tlmcAuth.apiKey } },
  )
  if (!response.ok) return []

  const data = await response.json()
  return data.rows ?? []
}
