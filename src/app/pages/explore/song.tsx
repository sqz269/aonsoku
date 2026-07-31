import { useInfiniteQuery } from '@tanstack/react-query'
import { Loader2Icon, PlayIcon, ShuffleIcon } from 'lucide-react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useParams } from 'react-router-dom'
import { getSimpleCoverArtUrl } from '@/api/httpClient'
import { TrackWithContext, tlmc } from '@/api/tlmcClient'
import { ShadowHeader } from '@/app/components/album/shadow-header'
import { HeaderTitle } from '@/app/components/header-title'
import ListWrapper from '@/app/components/list-wrapper'
import { Button } from '@/app/components/ui/button'
import { subsonic } from '@/service/subsonic'
import { usePlayerActions } from '@/store/player.store'
import { ISong } from '@/types/responses/song'

const MemoShadowHeader = memo(ShadowHeader)
const MemoHeaderTitle = memo(HeaderTitle)

const PAGE_SIZE = 50
const QUEUE_CAP = 30

// duration arrives as "hh:mm:ss(.fffffff)" — render m:ss.
function formatDuration(duration: string | null | undefined) {
  if (!duration) return '–:––'
  const [h, m, s] = duration.split(':').map((part) => Number.parseFloat(part))
  const total = Math.round(h * 3600 + m * 60 + s)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function shuffled<T>(input: T[]): T[] {
  const list = [...input]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

// Every arrangement of one official theme — the payoff screen no generic
// client can express. Rows play individually; play-all/shuffle build a queue.
export default function ExploreSongPage() {
  const { songId } = useParams<{ songId: string }>()
  const location = useLocation()
  const { t } = useTranslation()
  const { setSongList, playSong } = usePlayerActions()
  const [pending, setPending] = useState<string | null>(null)

  const state = (location.state ?? {}) as { title?: string; game?: string }
  const title = state.title ?? t('explore.arrangements')

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['tlmc-arrangements', songId],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        tlmc.getArrangements(songId ?? '', pageParam, PAGE_SIZE),
      getNextPageParam: (lastPage) => lastPage?.next ?? undefined,
      enabled: Boolean(songId),
    })

  const items = (data?.pages ?? []).flatMap((page) => page?.items ?? [])
  const playable = items.filter((item) => item.track?.has_media)

  async function hydrate(ids: string[]): Promise<ISong[]> {
    const songs = await Promise.all(ids.map((id) => subsonic.songs.getSong(id)))
    return songs.filter((song): song is ISong => Boolean(song))
  }

  async function playOne(item: TrackWithContext) {
    const id = item.track?.id
    if (!id) return
    setPending(id)
    try {
      const song = await subsonic.songs.getSong(id)
      if (song) playSong(song)
    } finally {
      setPending(null)
    }
  }

  async function playAll(shuffle: boolean) {
    setPending(shuffle ? 'shuffle' : 'all')
    try {
      let ids = playable
        .map((item) => item.track?.id)
        .filter((id): id is string => Boolean(id))
      if (shuffle) ids = shuffled(ids)
      const songs = await hydrate(ids.slice(0, QUEUE_CAP))
      if (songs.length > 0) {
        setSongList(songs, 0, false, {
          id: `explore-song-${songId}`,
          name: title,
          type: 'radio',
        })
      }
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="w-full h-full">
      <MemoShadowHeader>
        <MemoHeaderTitle title={title} count={items.length} />
      </MemoShadowHeader>

      <ListWrapper>
        <div className="mb-6 flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">
              {t('explore.arrangementsOf', { title })}
            </h1>
            {state.game && (
              <p className="truncate text-sm text-muted-foreground">
                {state.game}
              </p>
            )}
          </div>
          <Button
            disabled={pending === 'all' || playable.length === 0}
            onClick={() => playAll(false)}
          >
            {pending === 'all' ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <PlayIcon className="mr-2 size-4 fill-current" />
            )}
            {t('explore.playAll')}
          </Button>
          <Button
            variant="secondary"
            disabled={pending === 'shuffle' || playable.length === 0}
            onClick={() => playAll(true)}
          >
            {pending === 'shuffle' ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <ShuffleIcon className="mr-2 size-4" />
            )}
            {t('explore.shuffleAll')}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const trackId = item.track?.id ?? ''
            const circles = (item.circles ?? [])
              .map((circle) => circle.name)
              .join(', ')
            return (
              <div key={trackId} className="relative">
                <div className="flex w-full items-center gap-3 rounded-lg border bg-background-foreground p-2 pr-16">
                  <img
                    src={getSimpleCoverArtUrl(item.release?.id, 'album', '120')}
                    alt=""
                    loading="lazy"
                    className="size-11 flex-none rounded-md object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.track?.name?.default}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {circles}
                      {circles && item.release?.name?.default ? ' — ' : ''}
                      {item.release?.name?.default}
                    </span>
                  </span>
                  <span className="flex-none text-xs tabular-nums text-muted-foreground">
                    {formatDuration(item.track?.duration)}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={!item.track?.has_media || pending === trackId}
                  onClick={() => playOne(item)}
                  className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-accent transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-40"
                >
                  {pending === trackId ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <PlayIcon className="size-4 fill-current" />
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {hasNextPage && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {isFetchingNextPage ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : null}
              {t('explore.loadMore')}
            </Button>
          </div>
        )}
      </ListWrapper>
    </div>
  )
}
