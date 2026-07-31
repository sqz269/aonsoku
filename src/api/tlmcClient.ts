import createClient from 'openapi-fetch'
import { useAppStore } from '@/store/app.store'
import type { components, paths } from './tlmc-schema'

// Typed client for the TLMC native v6 API (/api/*), which lives on the same
// origin as the Subsonic facade (/rest/*). The whole catalogue is
// anonymous-readable, so no auth is attached.
//
// Types come from the backend's own OpenAPI document. Regenerate after
// backend contract changes with:
//   pnpm exec openapi-typescript https://tlmc.marisad.me/swagger/v1/swagger.json \
//     -o src/api/tlmc-schema.d.ts

export type LocalizedField = components['schemas']['LocalizedField']
export type OriginalWork = components['schemas']['OriginalWorkReadDto']
export type OriginalSong = components['schemas']['OriginalSongReadDto']
export type TrackWithContext = components['schemas']['TrackWithContext']
export type TrackRead = components['schemas']['TrackReadDto']
export type TrackMapResponse = components['schemas']['TrackMapResponseDto']

function client() {
  return createClient<paths>({
    baseUrl: useAppStore.getState().data.url ?? '',
  })
}

async function getTrack(id: string) {
  const { data } = await client().GET('/api/music/track/{id}', {
    params: { path: { id } },
  })
  return data
}

// Bump when a reloaded layout must reach clients before the daily bucket rolls.
const MAP_CACHE_EPOCH = 4

// ~10MB of parallel arrays for the whole library — fetch once, cache forever.
// The v token buckets the CDN cache by UTC day so a stale edge entry (or an
// ETL reload) never pins yesterday's map for longer than that.
async function getTrackMap() {
  const { data } = await client().GET('/api/music/track/map', {
    params: {
      query: {
        v: `${MAP_CACHE_EPOCH}-${new Date().toISOString().slice(0, 10)}`,
      },
    },
  })
  return data
}

async function getOriginalWorks() {
  const { data } = await client().GET('/api/source/work')
  return data
}

async function getOriginalWork(id: string) {
  const { data } = await client().GET('/api/source/work/{id}', {
    params: { path: { id } },
  })
  return data
}

async function getArrangements(
  songId: string,
  cursor?: string,
  limit?: number,
) {
  const { data } = await client().GET('/api/source/song/{id}/arrangements', {
    params: { path: { id: songId }, query: { cursor, limit } },
  })
  return data
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
  const { data } = await client().GET('/api/music/track/filter', {
    params: {
      query: {
        original_work_id: originalWorkId ? [originalWorkId] : undefined,
        release_date_from: releaseDateFrom,
        release_date_to: releaseDateTo,
        cursor,
        limit,
      },
    },
  })
  return data
}

export const tlmc = {
  getTrack,
  getTrackMap,
  getOriginalWorks,
  getOriginalWork,
  getArrangements,
  filterTracks,
}
