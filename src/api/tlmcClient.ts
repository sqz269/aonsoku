import { useAppStore } from '@/store/app.store'

// Client for the TLMC native v6 API (/api/*), which lives on the same origin
// as the Subsonic facade (/rest/*). The whole catalogue is anonymous-readable,
// so no auth params are attached. Wire shapes are snake_case.

export interface LocalizedField {
  default: string
  en?: string | null
  zh?: string | null
  jp?: string | null
}

export interface OriginalWork {
  id: string
  external_key: string
  work_type: string
  full_name: LocalizedField
  short_name: LocalizedField
}

export interface TrackWithContext {
  track: {
    id: string
    track_number: number
    name: LocalizedField
    duration: string | null
    has_media: boolean
    has_lyrics: boolean
  }
  release: {
    id: string
    name: LocalizedField
  }
  artwork_id: string | null
  circles: { id: string; name: string }[]
}

export interface CursorPage<T> {
  items: T[]
  next: string | null
}

async function tlmcFetch<T>(
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T | undefined> {
  const url = new URL(`${useAppStore.getState().data.url}/api${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  try {
    const response = await fetch(url)
    if (!response.ok) return undefined
    return (await response.json()) as T
  } catch {
    return undefined
  }
}

async function getOriginalWorks() {
  return tlmcFetch<OriginalWork[]>('/source/work')
}

interface FilterTracksParams {
  originalWorkId?: string
  releaseDateFrom?: string
  releaseDateTo?: string
  cursor?: string
  limit?: number
}

async function filterTracks({
  originalWorkId,
  releaseDateFrom,
  releaseDateTo,
  cursor,
  limit,
}: FilterTracksParams) {
  return tlmcFetch<CursorPage<TrackWithContext>>('/music/track/filter', {
    original_work_id: originalWorkId,
    release_date_from: releaseDateFrom,
    release_date_to: releaseDateTo,
    cursor,
    limit: limit?.toString(),
  })
}

export const tlmc = {
  getOriginalWorks,
  filterTracks,
}
