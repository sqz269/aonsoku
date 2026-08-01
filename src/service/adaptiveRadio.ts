import { getSessionJudgments } from '@/service/playReport'
import { getRadioNext } from '@/service/radio'
import { subsonic } from '@/service/subsonic'
import { useAppStore } from '@/store/app.store'
import { usePlayerStore } from '@/store/player.store'
import { ISong } from '@/types/responses/song'

// Keeps a signed-in radio queue alive and steering: when playback nears the
// end of a radio-sourced queue, fetch the next Rocchio batch — anchored on
// the session's first track, pulled toward what was completed and away from
// what was skipped — and append it without touching the playback context.
// Signed-out sessions keep the static 50-track radios.

const REFILL_THRESHOLD = 3
const QUEUE_CAP = 200
const BATCH_SIZE = 15
const COMPLETED_RATIO = 0.8
const SKIPPED_RATIO = 0.25

let inflight = false

export function initAdaptiveRadio() {
  usePlayerStore.subscribe(
    (state) => state.songlist.currentSongIndex,
    async () => {
      const { songlist, playerState } = usePlayerStore.getState()
      if (playerState.playbackContext.source?.type !== 'radio') return
      if (playerState.mediaType !== 'song') return
      if (!useAppStore.getState().data.tlmcAuth) return

      const list = songlist.currentList
      const remaining = list.length - songlist.currentSongIndex - 1
      if (remaining > REFILL_THRESHOLD || inflight) return
      if (list.length === 0 || list.length >= QUEUE_CAP) return

      inflight = true
      try {
        const listIds = list.map((song) => song.id)
        const queued = new Set(listIds)
        const judged = getSessionJudgments().filter((j) => queued.has(j.trackId))

        const ids = await getRadioNext({
          anchor: listIds[0],
          completed: judged
            .filter((j) => j.ratio >= COMPLETED_RATIO)
            .map((j) => j.trackId)
            .slice(-30),
          skipped: judged
            .filter((j) => j.ratio < SKIPPED_RATIO)
            .map((j) => j.trackId)
            .slice(-15),
          exclude: listIds,
          count: BATCH_SIZE,
        })
        if (ids.length === 0) return

        const songs = (
          await Promise.all(ids.map((id) => subsonic.songs.getSong(id)))
        ).filter((song): song is ISong => Boolean(song))
        if (songs.length > 0) {
          usePlayerStore.getState().actions.appendToQueue(songs)
        }
      } catch (error) {
        console.error('adaptive radio refill failed', error)
      } finally {
        inflight = false
      }
    },
  )
}
