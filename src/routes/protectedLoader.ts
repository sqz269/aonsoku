import { redirect } from 'react-router-dom'
import { queryServerInfo } from '@/api/queryServerInfo'
import { ROUTES } from '@/routes/routesList'
import { subsonic } from '@/service/subsonic'
import { useAppStore } from '@/store/app.store'

export async function protectedLoader() {
  const { url, password, isServerConfigured } = useAppStore.getState().data
  const hasNoUrl = !url || url === ''
  const hasNoToken = !password || password === ''

  if (hasNoUrl || hasNoToken || !isServerConfigured)
    return redirect(ROUTES.SERVER_CONFIG)

  let isServerUp = await subsonic.ping.pingView()

  // A revoked or stale API key must degrade to the guest session, not brick
  // the app into the server-config screen.
  if (!isServerUp && useAppStore.getState().data.tlmcAuth) {
    useAppStore.setState((state) => {
      state.data.tlmcAuth = null
    })
    isServerUp = await subsonic.ping.pingView()
  }

  if (!isServerUp) return redirect(ROUTES.SERVER_CONFIG)

  // Extensions are otherwise only captured at login time; refresh them in the
  // background so a long-lived session notices newly advertised capabilities.
  queryServerInfo(url).then((info) => {
    if (!info.extensionsSupported) return
    useAppStore.setState((state) => {
      state.data.extensionsSupported = info.extensionsSupported
      state.data.protocolVersion = info.protocolVersion
      state.data.serverType = info.serverType
    })
  })

  return null
}

export async function podcastsLoader() {
  const { active } = useAppStore.getState().podcasts

  if (!active) {
    return redirect(ROUTES.LIBRARY.HOME)
  }

  return null
}
