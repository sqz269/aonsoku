import { useAppStore } from '@/store/app.store'
import { PlaybackSource } from '@/types/playerContext'

// Phase 0 of the backend's Docs/RECOMMENDER.md: signed-in sessions report
// plays natively with real listened time and source attribution, replacing
// the binary Subsonic scrobble (player.store.ts gates the legacy path on
// nativeReportingActive). One client reports through exactly one path.

// The fork's PlaybackSourceType → the backend play_source enum. Artist pages
// and favourites are deliberate browsing, closest to album/playlist intent.
const SOURCE_MAP: Record<string, string> = {
  playlist: 'playlist',
  album: 'album',
  artist: 'album',
  favourite: 'playlist',
  songs: 'unknown',
  radio: 'radio',
  map: 'map',
  search: 'search',
  recommended: 'recommended',
}

export function nativeReportingActive() {
  return Boolean(useAppStore.getState().data.tlmcAuth)
}

export function toPlaySource(
  source: PlaybackSource | null,
  shuffled: boolean,
): string {
  if (source && SOURCE_MAP[source.type]) return SOURCE_MAP[source.type]
  return shuffled ? 'shuffle' : 'unknown'
}

// This session's listen ratios, newest last — the adaptive radio reads these
// to steer (service/adaptiveRadio.ts). In-memory only: a reload starts a new
// session, which matches how the radio itself scopes its feedback.
export interface SessionJudgment {
  trackId: string
  ratio: number
}

const sessionJudgments: SessionJudgment[] = []

export function getSessionJudgments(): readonly SessionJudgment[] {
  return sessionJudgments
}

export function reportPlay(
  trackId: string,
  msPlayed: number,
  source: string,
  durationSec?: number,
) {
  if (trackId && durationSec && durationSec > 0 && msPlayed >= 1000) {
    sessionJudgments.push({
      trackId,
      ratio: Math.min(msPlayed / 1000 / durationSec, 1),
    })
    if (sessionJudgments.length > 200) sessionJudgments.shift()
  }

  const { url, tlmcAuth } = useAppStore.getState().data
  // Sub-second listens are noise, not plays.
  if (!tlmcAuth || !trackId || msPlayed < 1000) return

  fetch(`${url}/api/user/history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': tlmcAuth.apiKey,
    },
    // Survives the request outliving a navigation (end-of-session reports).
    keepalive: true,
    body: JSON.stringify({
      track_id: trackId,
      ms_played: Math.round(msPlayed),
      source,
    }),
  }).catch(() => {})
}
