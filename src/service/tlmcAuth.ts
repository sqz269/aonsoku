import { useAppStore } from '@/store/app.store'

// OIDC bridge to the TLMC backend (its Docs/SUBSONIC.md section 4): Keycloak
// issues a short-lived JWT via authorization code + PKCE, the native API turns
// it into a durable per-device Subsonic API key, and every /rest call then
// authenticates with that key (see queryParams in api/httpClient.ts). OIDC
// never touches /rest itself — the Subsonic protocol has no redirect flow.
const ISSUER = 'https://sso.marisad.me/realms/MusicPlayer'
const CLIENT_ID = 'tlmc-player-web'
const PKCE_STORAGE_KEY = 'tlmc_oidc_pkce'
const TOKENS_STORAGE_KEY = 'tlmc_oidc_tokens'

interface StoredTokens {
  refreshToken?: string
  idToken?: string
}

function apiUrl(path: string) {
  return `${useAppStore.getState().data.url}${path}`
}

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function randomString() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function s256(verifier: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return b64url(new Uint8Array(digest))
}

// The bare origin, not the current hash route: Keycloak returns ?code= in the
// query string, which must land before the router's # fragment.
function redirectUri() {
  return `${window.location.origin}/`
}

function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(
      atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')),
    )
  } catch {
    return {}
  }
}

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  })
  if (!response.ok) throw new Error(`token endpoint: ${response.status}`)
  return (await response.json()) as {
    access_token: string
    refresh_token?: string
    id_token?: string
  }
}

export function beginTlmcLogin() {
  const verifier = randomString()
  const state = randomString()
  sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify({ verifier, state }))

  s256(verifier).then((challenge) => {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'code',
      response_mode: 'query',
      scope: 'openid',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    window.location.assign(`${ISSUER}/protocol/openid-connect/auth?${params}`)
  })
}

// Called once before the app renders (main.tsx). A no-op unless the URL is a
// Keycloak callback; on success the minted key lands in the app store and the
// page continues to boot as a signed-in session.
export async function completeTlmcLoginIfCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return

  // The code is one-shot: strip the query string before anything can re-run
  // the exchange (StrictMode, reloads, router redirects).
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.hash,
  )

  const stored = sessionStorage.getItem(PKCE_STORAGE_KEY)
  sessionStorage.removeItem(PKCE_STORAGE_KEY)
  if (!stored) return
  const { verifier, state: expected } = JSON.parse(stored)
  if (state !== expected) return

  try {
    const tokens = await tokenRequest({
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
      code,
      code_verifier: verifier,
    })
    const kept: StoredTokens = {
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
    }
    sessionStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(kept))
    await provisionApiKey(tokens.access_token)
  } catch (error) {
    console.error('TLMC sign-in failed', error)
  }
}

async function provisionApiKey(accessToken: string) {
  const auth = { Authorization: `Bearer ${accessToken}` }
  const claims = jwtClaims(accessToken)

  let displayName: string | undefined
  const profileRes = await fetch(apiUrl('/api/user/profile'), { headers: auth })
  if (profileRes.ok) {
    displayName = (await profileRes.json()).display_name
  } else {
    // First login: create the profile (the backend refuses to mint keys
    // without one). DisplayName is 3-50 chars; the sub-derived fallback covers
    // short/taken usernames.
    const preferred =
      typeof claims.preferred_username === 'string'
        ? claims.preferred_username
        : ''
    const candidates = [preferred, `user-${String(claims.sub).slice(0, 8)}`]
    for (const candidate of candidates) {
      if (candidate.length < 3 || candidate.length > 50) continue
      const created = await fetch(apiUrl('/api/user/profile'), {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: candidate }),
      })
      if (created.ok) {
        displayName = (await created.json()).display_name
        break
      }
    }
  }
  if (!displayName) throw new Error('could not resolve a user profile')

  const keyRes = await fetch(apiUrl('/api/user/api-keys'), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Aonsoku Web · ${new Date().toISOString().slice(0, 10)}`,
    }),
  })
  if (!keyRes.ok) throw new Error(`api key mint failed: ${keyRes.status}`)
  const key = await keyRes.json()

  useAppStore.getState().actions.setTlmcAuth({
    apiKey: key.key,
    apiKeyId: key.id,
    displayName,
  })
}

export async function signOutTlmc() {
  const { data, actions } = useAppStore.getState()
  const auth = data.tlmcAuth
  actions.setTlmcAuth(null)

  const raw = sessionStorage.getItem(TOKENS_STORAGE_KEY)
  sessionStorage.removeItem(TOKENS_STORAGE_KEY)
  const tokens: StoredTokens = raw ? JSON.parse(raw) : {}

  // Best-effort revocation: needs a live Keycloak session from this tab. When
  // it's gone the key just stays listed under the account until revoked there.
  if (auth && tokens.refreshToken) {
    try {
      const fresh = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      })
      await fetch(apiUrl(`/api/user/api-keys/${auth.apiKeyId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${fresh.access_token}` },
      })
    } catch (error) {
      console.warn('API key revocation skipped', error)
    }
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    post_logout_redirect_uri: redirectUri(),
  })
  if (tokens.idToken) params.set('id_token_hint', tokens.idToken)
  window.location.assign(`${ISSUER}/protocol/openid-connect/logout?${params}`)
}
