import { useAppStore } from '@/store/app.store'

// Stateless Rocchio radio (backend Docs/RECOMMENDER.md section 5): the client
// carries the session — anchor, completions, skips, and everything already
// queued — and gets back the next batch of ids. The nonce keeps per-user
// responses out of the edge cache.
export async function getRadioNext(params: {
  anchor: string
  completed: string[]
  skipped: string[]
  exclude: string[]
  count?: number
}): Promise<string[]> {
  const { url, tlmcAuth } = useAppStore.getState().data
  if (!tlmcAuth) return []

  const search = new URLSearchParams()
  search.set('anchor', params.anchor)
  search.set('count', String(params.count ?? 15))
  search.set('nonce', String(Date.now()))
  for (const id of params.completed) search.append('completed', id)
  for (const id of params.skipped) search.append('skipped', id)
  for (const id of params.exclude) search.append('exclude', id)

  const response = await fetch(`${url}/api/music/radio/next?${search}`, {
    headers: { 'X-Api-Key': tlmcAuth.apiKey },
  })
  if (!response.ok) return []

  const data = await response.json()
  return data.track_ids ?? []
}
