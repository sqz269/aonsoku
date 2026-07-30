import { useQuery } from '@tanstack/react-query'
import { Loader2Icon, PlayIcon, RadioIcon } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { tlmc } from '@/api/tlmcClient'
import { ShadowHeader } from '@/app/components/album/shadow-header'
import { HeaderTitle } from '@/app/components/header-title'
import ListWrapper from '@/app/components/list-wrapper'
import { Button } from '@/app/components/ui/button'
import { useExploreRadio } from '@/app/hooks/use-explore'
import { ROUTES } from '@/routes/routesList'

const MemoShadowHeader = memo(ShadowHeader)
const MemoHeaderTitle = memo(HeaderTitle)

// The Music Room: a game's official themes in track_index order, exactly like
// the in-game screen every fan already knows. Rows navigate to the theme's
// arrangement list; the corner button radios that theme's arrangements.
export default function ExploreGamePage() {
  const { workId } = useParams<{ workId: string }>()
  const { t } = useTranslation()
  const { pending, playGameRadio, playSongRadio } = useExploreRadio()

  const { data: work } = useQuery({
    queryKey: ['tlmc-work', workId],
    queryFn: () => tlmc.getOriginalWork(workId ?? ''),
    enabled: Boolean(workId),
    staleTime: Infinity,
  })

  const songs = work?.songs ?? []
  const gameName = work?.short_name?.default ?? t('explore.musicRoom')

  return (
    <div className="w-full h-full">
      <MemoShadowHeader>
        <MemoHeaderTitle title={gameName} count={songs.length} />
      </MemoShadowHeader>

      <ListWrapper>
        <div className="mb-6 flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">
              {work?.full_name?.default ?? ''}
            </h1>
            {work?.full_name?.en && (
              <p className="truncate text-sm text-muted-foreground">
                {work.full_name.en}
              </p>
            )}
          </div>
          <Button
            variant="secondary"
            disabled={pending === `game-${workId}`}
            onClick={() => workId && playGameRadio(workId, gameName)}
          >
            {pending === `game-${workId}` ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <RadioIcon className="mr-2 size-4" />
            )}
            {t('explore.radio')}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {songs.map((song) => (
            <div key={song.id} className="relative">
              <Link
                to={ROUTES.EXPLORE_SONG.PAGE(song.id ?? '')}
                state={{ title: song.title?.default, game: gameName }}
                className="flex w-full items-center gap-4 rounded-lg border bg-background-foreground p-3 pr-16 transition-colors hover:border-primary"
              >
                <span className="w-8 flex-none text-right text-sm tabular-nums text-muted-foreground">
                  {song.track_index ?? '–'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {song.title?.default}
                  </span>
                  {song.title?.en && song.title.en !== song.title.default && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {song.title.en}
                    </span>
                  )}
                </span>
              </Link>
              <button
                type="button"
                title={t('explore.radio')}
                disabled={pending === `song-${song.id}`}
                onClick={() =>
                  song.id && playSongRadio(song.id, song.title?.default ?? '')
                }
                className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-accent transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-60"
              >
                {pending === `song-${song.id}` ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <PlayIcon className="size-4 fill-current" />
                )}
              </button>
            </div>
          ))}
        </div>
      </ListWrapper>
    </div>
  )
}
