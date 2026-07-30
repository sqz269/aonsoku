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
export type TrackWithContext = components['schemas']['TrackWithContext']

function client() {
  return createClient<paths>({
    baseUrl: useAppStore.getState().data.url ?? '',
  })
}

async function getOriginalWorks() {
  const { data } = await client().GET('/api/source/work')
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
  getOriginalWorks,
  filterTracks,
}
