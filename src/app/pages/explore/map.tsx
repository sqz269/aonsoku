import { useQuery } from '@tanstack/react-query'
import { scaleLinear } from 'd3-scale'
import { Loader2Icon, PlayIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import createScatterplot from 'regl-scatterplot'
import { tlmc } from '@/api/tlmcClient'
import { Button } from '@/app/components/ui/button'
import {
  buildCircleContours,
  clearContourCache,
  ContourSet,
} from '@/app/pages/explore/map-contour'
import { subsonic } from '@/service/subsonic'
import { usePlayerActions } from '@/store/player.store'
import { useTheme } from '@/store/theme.store'
import { ISong } from '@/types/responses/song'

type Scatterplot = ReturnType<typeof createScatterplot>
type ColorMode = 'cluster' | 'era' | 'game' | 'circle'

// Distinct colors run out long before 2,698 circles do: the legend arrives
// largest-first, so the first TOP_CIRCLES get real colors and the tail is muted.
const TOP_CIRCLES = 48

const QUEUE_CAP = 30
const ERA_MIN = 2000
const ERA_MAX = 2026

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const light = l / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = light - sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

// Golden-angle hue walk: neighboring indices land far apart on the wheel, so
// size-ordered cluster ids and legend-ordered games still alternate colors.
function categoricalPalette(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    hslToHex((i * 137.508) % 360, 68, i % 2 === 0 ? 58 : 46),
  )
}

function eraPalette(): string[] {
  const span = ERA_MAX - ERA_MIN
  return Array.from({ length: span + 1 }, (_, i) =>
    hslToHex(230 - (i / span) * 230, 72, 55),
  )
}

const UNKNOWN_COLOR = '#5c5c66'

function shuffled<T>(input: T[]): T[] {
  const list = [...input]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

// The whole library as one WebGL point cloud over the MERT embedding layout.
// Click = sound, immediately; a lasso turns a region of the map into a queue.
export default function ExploreMapPage() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { setSongList, playSong } = usePlayerActions()

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const scatterplotRef = useRef<Scatterplot | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const contoursRef = useRef<ContourSet | null>(null)
  const overlayColorRef = useRef('255, 255, 255')

  const [colorMode, setColorMode] = useState<ColorMode>('cluster')
  const [selection, setSelection] = useState<number[]>([])
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [cursor, setCursor] = useState({ x: 0, y: 0 })
  const [pending, setPending] = useState(false)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [plotReady, setPlotReady] = useState(false)
  const [circleQuery, setCircleQuery] = useState('')
  const [selectedCircle, setSelectedCircle] = useState<number | null>(null)
  const [activeClusters, setActiveClusters] = useState<ReadonlySet<number>>(
    new Set(),
  )
  const [bandwidth, setBandwidth] = useState(4)
  const [relative, setRelative] = useState(true)

  const { data: map, isLoading } = useQuery({
    queryKey: ['tlmc-track-map'],
    queryFn: tlmc.getTrackMap,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  const hoverId = hoverIndex != null ? (map?.ids?.[hoverIndex] ?? null) : null
  const { data: hoverTrack } = useQuery({
    queryKey: ['tlmc-track', hoverId],
    queryFn: () => tlmc.getTrack(hoverId ?? ''),
    enabled: Boolean(hoverId),
    staleTime: Infinity,
  })

  const playOne = useCallback(
    async (index: number) => {
      const id = map?.ids?.[index]
      if (!id) return
      setPending(true)
      try {
        const song = await subsonic.songs.getSong(id)
        if (song) playSong(song)
      } finally {
        setPending(false)
      }
    },
    [map, playSong],
  )

  // Project the cached data-space contour rings through the current camera
  // scales onto the 2D overlay. Pure ref plumbing so pan/zoom redraws never
  // re-render React.
  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current
    const scatterplot = scatterplotRef.current
    const ctx = overlay?.getContext('2d')
    if (!overlay || !scatterplot || !ctx) return

    const dpr = window.devicePixelRatio || 1
    ctx.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr)
    const set = contoursRef.current
    if (!set || set.polygons.length === 0) return

    const xScale = scatterplot.get('xScale')
    const yScale = scatterplot.get('yScale')
    if (!xScale || !yScale) return

    const rgb = overlayColorRef.current
    set.polygons.forEach((rings, level) => {
      const strength = set.strengths[level]
      ctx.beginPath()
      for (const ring of rings) {
        ring.forEach(([dataX, dataY], i) => {
          const px = xScale(dataX)
          const py = yScale(dataY)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        ctx.closePath()
      }
      ctx.fillStyle = `rgba(${rgb}, ${0.03 + 0.07 * strength})`
      ctx.strokeStyle = `rgba(${rgb}, ${0.3 + 0.5 * strength})`
      ctx.lineWidth = level === set.polygons.length - 1 ? 1.5 : 1
      ctx.lineJoin = 'round'
      ctx.fill()
      ctx.stroke()
    })
  }, [])

  // The route renders inside the main scroll area, whose Radix viewport sizes
  // children by content — h-full collapses to 0 there, and a 0-height canvas
  // makes regl-scatterplot's projection matrix singular (it crashes). Mirror
  // the scroll area's height onto the container explicitly instead.
  useEffect(() => {
    const scrollArea = document.getElementById('main-scroll-area')
    if (!scrollArea) return

    const update = () => setViewportHeight(scrollArea.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scrollArea)
    return () => observer.disconnect()
  }, [])

  const hasSize = viewportHeight > 0

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !hasSize) return

    const { width, height } = container.getBoundingClientRect()
    const scatterplot = createScatterplot({
      canvas,
      width: Math.max(1, width),
      height: Math.max(1, height),
      pointSize: 1.75,
      opacityBy: 'density',
      lassoInitiator: true,
      lassoOnLongPress: true,
      actionKeyMap: { shift: 'lasso' },
      // Real d3 scales make regl-scatterplot keep data->pixel mappings in sync
      // with the camera — that is what the contour overlay projects through.
      xScale: scaleLinear().domain([-1, 1]),
      yScale: scaleLinear().domain([-1, 1]),
    })
    scatterplotRef.current = scatterplot
    setPlotReady(true)

    const sizeOverlay = (w: number, h: number) => {
      const overlay = overlayRef.current
      if (!overlay) return
      const dpr = window.devicePixelRatio || 1
      overlay.width = Math.round(w * dpr)
      overlay.height = Math.round(h * dpr)
      overlay.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    sizeOverlay(width, height)

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) {
        scatterplot.set({ width: rect.width, height: rect.height })
        sizeOverlay(rect.width, rect.height)
        drawOverlay()
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      scatterplotRef.current = null
      setPlotReady(false)
      scatterplot.destroy()
    }
  }, [hasSize, drawOverlay])

  // (Re)draw whenever the data or the coloring lens changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: plotReady re-runs this once the late-initialized plot exists
  useEffect(() => {
    const scatterplot = scatterplotRef.current
    if (!scatterplot || !map?.x?.length) return

    const {
      x,
      y,
      cluster = [],
      year = [],
      work = [],
      works = [],
      circle = [],
    } = map
    let valueA: number[]
    let palette: string[]
    if (colorMode === 'cluster') {
      const top = cluster.reduce((acc, c) => Math.max(acc, c), 0)
      valueA = cluster.map((c) => c + 1)
      palette = [UNKNOWN_COLOR, ...categoricalPalette(top + 1)]
    } else if (colorMode === 'circle') {
      valueA = circle.map((c) => (c >= 0 && c < TOP_CIRCLES ? c + 1 : 0))
      palette = [UNKNOWN_COLOR, ...categoricalPalette(TOP_CIRCLES)]
    } else if (colorMode === 'era') {
      valueA = year.map((value) =>
        value === 0
          ? 0
          : Math.min(Math.max(value - ERA_MIN, 0), ERA_MAX - ERA_MIN) + 1,
      )
      palette = [UNKNOWN_COLOR, ...eraPalette()]
    } else {
      valueA = work.map((w) => w + 1)
      palette = [UNKNOWN_COLOR, ...categoricalPalette(works.length)]
    }

    scatterplot.set({ colorBy: 'valueA', pointColor: palette })
    scatterplot.draw(
      { x: x ?? [], y: y ?? [], valueA },
      { transition: false },
    )
  }, [map, colorMode, plotReady])

  // Match whatever the active theme paints behind the app — parsing the
  // computed color beats hardcoding a light/dark split across ~20 themes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: theme is the re-run trigger; the value is read from the DOM
  useEffect(() => {
    const channels = getComputedStyle(document.body)
      .backgroundColor.match(/\d+(\.\d+)?/g)
      ?.slice(0, 3)
      .map((value) => Number(value) / 255)
    if (channels?.length === 3) {
      scatterplotRef.current?.set({
        backgroundColor: [channels[0], channels[1], channels[2], 1],
      })
      const luminance =
        0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2]
      overlayColorRef.current = luminance > 0.5 ? '20, 20, 30' : '255, 255, 255'
      drawOverlay()
    }
  }, [theme, plotReady, drawOverlay])

  const clusterNames = useMemo(() => {
    const names = new Map<number, string>()
    for (const entry of map?.clusters ?? []) {
      if (entry.id != null && entry.name) names.set(entry.id, entry.name)
    }
    return names
  }, [map])
  const clusterCount = useMemo(
    () => (map?.cluster ?? []).reduce((acc, c) => Math.max(acc, c + 1), 0),
    [map],
  )

  const circles = useMemo(() => map?.circles ?? [], [map])
  const selectedCircleEntry =
    selectedCircle != null ? (circles[selectedCircle] ?? null) : null
  const circleMatches = useMemo(() => {
    const query = circleQuery.trim().toLowerCase()
    if (!query) return []
    const matches: Array<{ entry: (typeof circles)[number]; index: number }> =
      []
    for (let i = 0; i < circles.length && matches.length < 10; i++) {
      if ((circles[i].name ?? '').toLowerCase().includes(query)) {
        matches.push({ entry: circles[i], index: i })
      }
    }
    return matches
  }, [circles, circleQuery])

  // Contours track the picked circle and its density controls; geometry lives
  // in data space so pan/zoom only ever re-projects.
  const contourSet = useMemo(() => {
    if (!map?.x || !map?.y || selectedCircle == null) return null
    const indices: number[] = []
    const circle = map.circle ?? []
    for (let i = 0; i < circle.length; i++) {
      if (circle[i] === selectedCircle) indices.push(i)
    }
    if (indices.length === 0) return null
    return buildCircleContours(map.x, map.y, indices, bandwidth, relative)
  }, [map, selectedCircle, bandwidth, relative])

  useEffect(() => {
    contoursRef.current = contourSet
    drawOverlay()
  }, [contourSet, drawOverlay])

  // New payload (an ETL reload) invalidates the cached library-density field.
  useEffect(() => {
    if (map) clearContourCache()
  }, [map])

  // Legend rows are layer toggles: an empty set means everything, otherwise
  // only the chosen families' points survive the filter. Leaving the Sound
  // lens drops the filter — the other lenses color what the toggles hide.
  useEffect(() => {
    if (colorMode !== 'cluster' && activeClusters.size > 0) {
      setActiveClusters(new Set())
    }
  }, [colorMode, activeClusters])

  useEffect(() => {
    const scatterplot = scatterplotRef.current
    if (!scatterplot || !map?.cluster) return
    if (activeClusters.size === 0) {
      scatterplot.unfilter()
      return
    }
    const indices: number[] = []
    for (let i = 0; i < map.cluster.length; i++) {
      if (activeClusters.has(map.cluster[i])) indices.push(i)
    }
    scatterplot.filter(indices)
  }, [activeClusters, map, plotReady])

  function toggleCluster(cluster: number) {
    setActiveClusters((current) => {
      const next = new Set(current)
      if (next.has(cluster)) next.delete(cluster)
      else next.add(cluster)
      return next
    })
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: plotReady re-runs this once the late-initialized plot exists
  useEffect(() => {
    const scatterplot = scatterplotRef.current
    if (!scatterplot) return
    let frame = 0
    const onView = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(drawOverlay)
    }
    scatterplot.subscribe('view', onView)
    return () => {
      cancelAnimationFrame(frame)
      scatterplot.unsubscribe('view', onView)
    }
  }, [plotReady, drawOverlay])

  // Click = sound. A lasso hands the region to the action bar instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: plotReady re-runs this once the late-initialized plot exists
  useEffect(() => {
    const scatterplot = scatterplotRef.current
    if (!scatterplot) return

    const onSelect = ({ points }: { points: number[] }) => {
      if (points.length === 1) {
        setSelection([])
        playOne(points[0])
      } else if (points.length > 1) {
        setSelection(points)
      }
    }
    const onDeselect = () => setSelection([])
    const onPointOver = (index: number) => {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = setTimeout(() => setHoverIndex(index), 120)
    }
    const onPointOut = () => {
      clearTimeout(hoverTimerRef.current)
      setHoverIndex(null)
    }

    scatterplot.subscribe('select', onSelect)
    scatterplot.subscribe('deselect', onDeselect)
    scatterplot.subscribe('pointOver', onPointOver)
    scatterplot.subscribe('pointOut', onPointOut)
    return () => {
      scatterplot.unsubscribe('select', onSelect)
      scatterplot.unsubscribe('deselect', onDeselect)
      scatterplot.unsubscribe('pointOver', onPointOver)
      scatterplot.unsubscribe('pointOut', onPointOut)
    }
  }, [playOne, plotReady])

  async function playSelection() {
    if (!map?.ids || selection.length === 0) return
    setPending(true)
    try {
      const ids = shuffled(selection)
        .slice(0, QUEUE_CAP)
        .map((index) => map.ids?.[index])
        .filter((id): id is string => Boolean(id))
      const songs = (
        await Promise.all(ids.map((id) => subsonic.songs.getSong(id)))
      ).filter((song): song is ISong => Boolean(song))
      if (songs.length > 0) {
        setSongList(songs, 0, false, {
          id: 'explore-map',
          name: t('explore.map.title'),
          type: 'songs',
        })
      }
    } finally {
      setPending(false)
    }
  }

  function clearSelection() {
    scatterplotRef.current?.deselect()
    setSelection([])
  }

  const hoverCircles = (hoverTrack?.circles ?? [])
    .map((circle) => circle.name)
    .join(', ')

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden"
      style={{ height: viewportHeight || undefined }}
      onMouseMove={(event) => {
        if (hoverIndex == null) return
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top })
        }
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
      />

      <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-2">
        <div className="pointer-events-auto w-72 rounded-lg border bg-background/80 p-3 backdrop-blur">
          <h1 className="text-sm font-semibold">{t('explore.map.title')}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('explore.map.hint')}
          </p>
          <div className="mt-2 flex gap-1">
            {(['cluster', 'era', 'game', 'circle'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={colorMode === mode ? 'default' : 'secondary'}
                className="h-7 px-2 text-xs"
                onClick={() => setColorMode(mode)}
              >
                {t(`explore.map.${mode}`)}
              </Button>
            ))}
          </div>

          <div className="mt-3 border-t pt-2">
            {selectedCircleEntry ? (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {selectedCircleEntry.name}
                </span>
                <span className="flex-none text-xs tabular-nums text-muted-foreground">
                  {selectedCircleEntry.count}
                </span>
                <button
                  type="button"
                  className="flex size-6 flex-none items-center justify-center rounded-full hover:bg-accent"
                  onClick={() => setSelectedCircle(null)}
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={circleQuery}
                  onChange={(event) => setCircleQuery(event.target.value)}
                  placeholder={t('explore.map.searchCircle')}
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
                />
                {circleMatches.length > 0 && (
                  <div className="absolute inset-x-0 top-9 z-20 overflow-hidden rounded-md border bg-background shadow-lg">
                    {circleMatches.map(({ entry, index }) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          setSelectedCircle(index)
                          setCircleQuery('')
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {entry.name}
                        </span>
                        <span className="flex-none text-xs tabular-nums text-muted-foreground">
                          {entry.count}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedCircleEntry && (
              <div className="mt-2 flex flex-col gap-1.5">
                <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  {t('explore.map.smoothing')}
                  <input
                    type="range"
                    min={2}
                    max={10}
                    step={0.5}
                    value={bandwidth}
                    onChange={(event) =>
                      setBandwidth(Number(event.target.value))
                    }
                    className="w-32 accent-primary"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-muted-foreground">
                  {t('explore.map.relativeDensity')}
                  <input
                    type="checkbox"
                    checked={relative}
                    onChange={(event) => setRelative(event.target.checked)}
                    className="accent-primary"
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {colorMode === 'cluster' && clusterNames.size > 0 && (
          <div className="pointer-events-auto max-h-72 w-72 overflow-y-auto rounded-lg border bg-background/80 p-2 backdrop-blur">
            {activeClusters.size > 0 && (
              <button
                type="button"
                className="mb-1 w-full rounded px-1 py-0.5 text-left text-xs font-medium text-primary hover:bg-accent"
                onClick={() => setActiveClusters(new Set())}
              >
                {t('explore.map.showAll')}
              </button>
            )}
            {Array.from({ length: clusterCount }, (_, c) => {
              const dimmed =
                activeClusters.size > 0 && !activeClusters.has(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCluster(c)}
                  className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-accent ${
                    dimmed ? 'opacity-40' : ''
                  }`}
                >
                  <span
                    className="size-2.5 flex-none rounded-full"
                    style={{
                      backgroundColor: categoricalPalette(clusterCount)[c],
                    }}
                  />
                  <span
                    className={`truncate text-xs ${
                      activeClusters.has(c) ? 'font-semibold' : ''
                    }`}
                  >
                    {clusterNames.get(c) ?? `#${c}`}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {(isLoading || pending) && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-lg border bg-background/80 px-4 py-2 backdrop-blur">
            <Loader2Icon className="size-4 animate-spin" />
            <span className="text-sm">
              {isLoading ? t('explore.map.loading') : t('explore.map.starting')}
            </span>
          </div>
        </div>
      )}

      {selection.length > 1 && (
        <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-background/90 py-2 pl-4 pr-2 backdrop-blur">
          <span className="text-sm tabular-nums">
            {t('explore.map.selected', { count: selection.length })}
          </span>
          <Button
            size="sm"
            className="rounded-full"
            disabled={pending}
            onClick={playSelection}
          >
            <PlayIcon className="mr-1.5 size-3.5 fill-current" />
            {t('explore.map.playSelection', {
              count: Math.min(selection.length, QUEUE_CAP),
            })}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 rounded-full"
            onClick={clearSelection}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      )}

      {hoverIndex != null && hoverTrack && (
        <div
          className="pointer-events-none absolute z-20 max-w-72 rounded-md border bg-background/95 px-3 py-2 backdrop-blur"
          style={{ left: cursor.x + 14, top: cursor.y + 14 }}
        >
          <p className="truncate text-sm font-medium">
            {hoverTrack.name?.default}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {hoverCircles}
            {hoverCircles && hoverTrack.release?.name?.default ? ' — ' : ''}
            {hoverTrack.release?.name?.default}
          </p>
          <p className="text-xs text-muted-foreground">
            {[
              map?.year?.[hoverIndex] || null,
              clusterNames.get(map?.cluster?.[hoverIndex] ?? -1) ?? null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )}
    </div>
  )
}
