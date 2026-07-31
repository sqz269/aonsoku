import { useState } from 'react'
import { TrackWithContext, tlmc } from '@/api/tlmcClient'
import { subsonic } from '@/service/subsonic'
import { usePlayerActions } from '@/store/player.store'
import { PlaybackSource } from '@/types/playerContext'
import { ISong } from '@/types/responses/song'

// Radio primitives for the Explore page. Playable lists always end up as real
// ISong objects from the Subsonic facade (never hand-built); the native API is
// only used to *choose* track ids (by game, by era), which are then hydrated
// through /getSong.

const RADIO_SIZE = 30
const CANDIDATE_PAGES = 2
const PAGE_LIMIT = 100

function shuffle<T>(input: T[]): T[] {
  const list = [...input]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

type PageFetcher = (
  cursor: string | undefined,
) => Promise<{ items: TrackWithContext[]; next: string | null } | undefined>

export function useExploreRadio() {
  const { setSongList } = usePlayerActions()
  const [pending, setPending] = useState<string | null>(null)

  function start(songs: ISong[] | undefined, source: PlaybackSource) {
    if (songs && songs.length > 0) {
      setSongList(songs, 0, false, source)
    }
  }

  async function playRandom() {
    setPending('random')
    try {
      const songs = await subsonic.songs.getRandomSongs({ size: 50 })
      start(songs, {
        id: 'explore-random',
        name: 'Explore Radio',
        type: 'radio',
      })
    } finally {
      setPending(null)
    }
  }

  async function playSimilar(song: ISong) {
    setPending('similar')
    try {
      const similar = await subsonic.songs.getSimilarSongs(song.id, 50)
      start([song, ...similar], {
        id: `explore-similar-${song.id}`,
        name: song.title,
        type: 'radio',
      })
    } finally {
      setPending(null)
    }
  }

  async function playFromNativeTracks(
    key: string,
    name: string,
    fetchPage: PageFetcher,
  ) {
    setPending(key)
    try {
      const candidates: TrackWithContext[] = []
      let cursor: string | undefined
      for (let page = 0; page < CANDIDATE_PAGES; page++) {
        const result = await fetchPage(cursor)
        if (!result) break
        candidates.push(...result.items)
        if (!result.next) break
        cursor = result.next
      }

      const ids = shuffle(
        candidates.filter((t) => t.track.has_media).map((t) => t.track.id),
      ).slice(0, RADIO_SIZE)

      const songs = (
        await Promise.all(ids.map((id) => subsonic.songs.getSong(id)))
      ).filter((song): song is ISong => Boolean(song))

      start(songs, { id: key, name, type: 'radio' })
    } finally {
      setPending(null)
    }
  }

  async function playGameRadio(workId: string, name: string) {
    await playFromNativeTracks(`game-${workId}`, name, (cursor) =>
      tlmc.filterTracks({ originalWorkId: workId, cursor, limit: PAGE_LIMIT }),
    )
  }

  async function playSongRadio(songId: string, name: string) {
    await playFromNativeTracks(`song-${songId}`, name, (cursor) =>
      tlmc.getArrangements(songId, cursor, PAGE_LIMIT),
    )
  }

  async function playEraRadio(
    id: string,
    name: string,
    from: string,
    to: string,
  ) {
    await playFromNativeTracks(`era-${id}`, name, (cursor) =>
      tlmc.filterTracks({
        releaseDateFrom: from,
        releaseDateTo: to,
        cursor,
        limit: PAGE_LIMIT,
      }),
    )
  }

  return {
    pending,
    playRandom,
    playSimilar,
    playGameRadio,
    playSongRadio,
    playEraRadio,
  }
}
