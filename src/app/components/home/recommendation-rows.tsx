import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageLoader } from '@/app/components/image-loader'
import { PreviewCard } from '@/app/components/preview-card/card'
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from '@/app/components/ui/carousel'
import { CarouselButton } from '@/app/components/ui/carousel-button'
import { ROUTES } from '@/routes/routesList'
import { getHomeRows, RecommendationRow } from '@/service/recommendations'
import { subsonic } from '@/service/subsonic'
import { useAppStore } from '@/store/app.store'
import { usePlayerActions } from '@/store/player.store'
import { ISong } from '@/types/responses/song'

// Personalized rows above the library sections, signed-in only
// (backend Docs/RECOMMENDER.md section 4). Ids arrive from the server —
// hydration goes through getSong so covers/artists render with the exact
// data every other surface uses; plays tag source=recommended.

const ROW_TITLE_KEY: Record<string, string> = {
  'home.because': 'home.recs.because',
  'home.arrangements': 'home.recs.arrangements',
  'home.territory': 'home.recs.territory',
  'home.rediscover': 'home.recs.rediscover',
  'home.family': 'home.recs.family',
}

interface HydratedRow {
  row: RecommendationRow
  songs: ISong[]
}

export function RecommendationRows() {
  const tlmcAuth = useAppStore((state) => state.data.tlmcAuth)

  const { data } = useQuery({
    queryKey: ['recommendations-home', tlmcAuth?.apiKeyId],
    enabled: Boolean(tlmcAuth),
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<HydratedRow[]> => {
      const rows = await getHomeRows()
      return Promise.all(
        rows.map(async (row) => ({
          row,
          songs: (
            await Promise.all(
              row.track_ids.map((id) => subsonic.songs.getSong(id)),
            )
          ).filter((song): song is ISong => Boolean(song)),
        })),
      )
    },
  })

  if (!tlmcAuth || !data) return null

  return (
    <>
      {data
        .filter(({ songs }) => songs.length > 0)
        .map(({ row, songs }) => (
          <SongCarousel
            key={`${row.surface}-${row.title ?? ''}`}
            row={row}
            songs={songs}
          />
        ))}
    </>
  )
}

function SongCarousel({ row, songs }: HydratedRow) {
  const { t } = useTranslation()
  const [api, setApi] = useState<CarouselApi>()
  const [canScrollPrev, setCanScrollPrev] = useState<boolean>()
  const [canScrollNext, setCanScrollNext] = useState<boolean>()
  const { setSongList } = usePlayerActions()

  useEffect(() => {
    if (!api) return
    setCanScrollPrev(api.canScrollPrev())
    setCanScrollNext(api.canScrollNext())
    api.on('select', () => {
      setCanScrollPrev(api.canScrollPrev())
      setCanScrollNext(api.canScrollNext())
    })
  }, [api])

  const titleKey = ROW_TITLE_KEY[row.surface] ?? 'home.recs.generic'

  function playFrom(index: number) {
    setSongList(songs, index, false, {
      id: row.surface,
      name: t(titleKey, { name: row.title ?? '' }),
      type: 'recommended',
    })
  }

  return (
    <div className="w-full flex flex-col mt-4">
      <div className="my-4 flex justify-between items-center">
        <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">
          {t(titleKey, { name: row.title ?? '' })}
        </h3>
        <div className="flex gap-2">
          <CarouselButton
            direction="prev"
            disabled={!canScrollPrev}
            onClick={() => api?.scrollPrev()}
          />
          <CarouselButton
            direction="next"
            disabled={!canScrollNext}
            onClick={() => api?.scrollNext()}
          />
        </div>
      </div>

      <div className="transform-gpu">
        <Carousel opts={{ align: 'start', slidesToScroll: 'auto' }} setApi={setApi}>
          <CarouselContent>
            {songs.map((song, index) => (
              <CarouselItem key={song.id} className="basis-1/6 2xl:basis-1/8">
                <PreviewCard.Root>
                  <PreviewCard.ImageWrapper link={ROUTES.ALBUM.PAGE(song.albumId)}>
                    <ImageLoader id={song.coverArt} type="album" size={300}>
                      {(src) => <PreviewCard.Image src={src} alt={song.title} />}
                    </ImageLoader>
                    <PreviewCard.PlayButton onClick={() => playFrom(index)} />
                  </PreviewCard.ImageWrapper>
                  <PreviewCard.InfoWrapper>
                    <PreviewCard.Title link={ROUTES.ALBUM.PAGE(song.albumId)}>
                      {song.title}
                    </PreviewCard.Title>
                    <PreviewCard.Subtitle
                      enableLink={song.artistId !== undefined}
                      link={ROUTES.ARTIST.PAGE(song.artistId ?? '')}
                    >
                      {song.artist}
                    </PreviewCard.Subtitle>
                  </PreviewCard.InfoWrapper>
                </PreviewCard.Root>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>
    </div>
  )
}
