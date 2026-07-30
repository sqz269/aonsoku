import { useQuery } from '@tanstack/react-query'
import {
  CalendarRangeIcon,
  Gamepad2Icon,
  Loader2Icon,
  PlayIcon,
  SparklesIcon,
} from 'lucide-react'
import { memo, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { tlmc } from '@/api/tlmcClient'
import { ShadowHeader } from '@/app/components/album/shadow-header'
import { HeaderTitle } from '@/app/components/header-title'
import ListWrapper from '@/app/components/list-wrapper'
import { Button } from '@/app/components/ui/button'
import { useExploreRadio } from '@/app/hooks/use-explore'
import { ROUTES } from '@/routes/routesList'
import { usePlayerStore } from '@/store/player.store'

const MemoShadowHeader = memo(ShadowHeader)
const MemoHeaderTitle = memo(HeaderTitle)

interface Era {
  id: string
  name: string
  years: string
  from: string
  to: string
}

const ERAS: Era[] = [
  {
    id: 'early',
    name: 'Early days',
    years: '2002–2007',
    from: '2002-01-01',
    to: '2007-12-31',
  },
  {
    id: 'golden',
    name: 'Golden age',
    years: '2008–2012',
    from: '2008-01-01',
    to: '2012-12-31',
  },
  {
    id: 'mid',
    name: 'Mid era',
    years: '2013–2017',
    from: '2013-01-01',
    to: '2017-12-31',
  },
  {
    id: 'modern',
    name: 'Modern',
    years: '2018–now',
    from: '2018-01-01',
    to: '2030-12-31',
  },
]

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-8 mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  )
}

function RadioTile({
  title,
  subtitle,
  loading,
  onPlay,
}: {
  title: string
  subtitle?: string
  loading: boolean
  onPlay: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      disabled={loading}
      className="group flex w-full items-center gap-3 rounded-lg border bg-background-foreground p-3 text-left transition-colors hover:border-primary disabled:opacity-60"
    >
      <span className="flex size-9 flex-none items-center justify-center rounded-full bg-accent group-hover:bg-primary group-hover:text-primary-foreground">
        {loading ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <PlayIcon className="size-4 fill-current" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="block truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
    </button>
  )
}

// Navigate-first tile: the body links into the Music Room; the corner button
// is the radio affordance. Games are browse units, themes are listening units.
function NavRadioTile({
  title,
  subtitle,
  to,
  loading,
  onPlay,
}: {
  title: string
  subtitle?: string
  to: string
  loading: boolean
  onPlay: () => void
}) {
  return (
    <div className="relative">
      <Link
        to={to}
        className="flex w-full items-center rounded-lg border bg-background-foreground p-3 pr-14 transition-colors hover:border-primary"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{title}</span>
          {subtitle && (
            <span className="block truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </span>
      </Link>
      <button
        type="button"
        onClick={onPlay}
        disabled={loading}
        className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-accent transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-60"
      >
        {loading ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <PlayIcon className="size-4 fill-current" />
        )}
      </button>
    </div>
  )
}

export default function ExplorePage() {
  const { t } = useTranslation()
  const { pending, playRandom, playSimilar, playGameRadio, playEraRadio } =
    useExploreRadio()
  const currentSong = usePlayerStore((state) => state.songlist.currentSong)

  const { data: works } = useQuery({
    queryKey: ['tlmc-original-works'],
    queryFn: tlmc.getOriginalWorks,
    staleTime: Infinity,
  })

  const games = (works ?? []).filter((work) => work.work_type === 'Game')

  return (
    <div className="w-full h-full">
      <MemoShadowHeader>
        <MemoHeaderTitle title={t('sidebar.explore')} />
      </MemoShadowHeader>

      <ListWrapper>
        <div className="flex items-center gap-5 rounded-xl border bg-gradient-to-r from-primary/15 to-transparent p-6">
          <Button
            size="icon"
            className="size-14 flex-none rounded-full [&_svg]:size-6"
            disabled={pending === 'random'}
            onClick={playRandom}
          >
            {pending === 'random' ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <PlayIcon className="fill-current" />
            )}
          </Button>
          <div>
            <h1 className="text-lg font-semibold">
              {t('explore.playSomething')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('explore.playSomethingDescription')}
            </p>
          </div>
        </div>

        <SectionTitle>
          <SparklesIcon className="mr-1 inline size-3.5" />
          {t('explore.fromCurrent')}
        </SectionTitle>
        {currentSong?.id ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <RadioTile
              title={t('explore.moreLikeThis')}
              subtitle={t('explore.basedOn', { title: currentSong.title })}
              loading={pending === 'similar'}
              onPlay={() => playSimilar(currentSong)}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('explore.nothingPlaying')}
          </p>
        )}

        <SectionTitle>
          <Gamepad2Icon className="mr-1 inline size-3.5" />
          {t('explore.byGame')}
        </SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {games.map((work) => (
            <NavRadioTile
              key={work.id}
              title={work.short_name.default}
              subtitle={work.full_name.en ?? work.full_name.default}
              to={ROUTES.EXPLORE_GAME.PAGE(work.id ?? '')}
              loading={pending === `game-${work.id}`}
              onPlay={() => playGameRadio(work.id, work.short_name.default)}
            />
          ))}
        </div>

        <SectionTitle>
          <CalendarRangeIcon className="mr-1 inline size-3.5" />
          {t('explore.byEra')}
        </SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {ERAS.map((era) => (
            <RadioTile
              key={era.id}
              title={era.name}
              subtitle={era.years}
              loading={pending === `era-${era.id}`}
              onPlay={() => playEraRadio(era.id, era.name, era.from, era.to)}
            />
          ))}
        </div>
      </ListWrapper>
    </div>
  )
}
