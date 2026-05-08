import { NextResponse } from 'next/server'

/**
 * API Route: /api/turn-credentials
 *
 * Returns ICE server configuration for WebRTC (STUN + TURN).
 * Credentials are stored server-side only — never exposed in client code.
 *
 * Flow:
 * 1. Try to create a fresh credential via Metered REST API (dynamic, expirable)
 * 2. If that fails (e.g., app subdomain not configured), fall back to static credentials
 */
export async function GET() {
  const secretKey = process.env.METERED_SECRET_KEY
  const staticUsername = process.env.METERED_TURN_USERNAME
  const staticCredential = process.env.METERED_TURN_CREDENTIAL
  const region = process.env.METERED_TURN_REGION || 'global'

  if (!secretKey || !staticUsername || !staticCredential) {
    return NextResponse.json(
      { error: 'TURN server credentials not configured' },
      { status: 500 }
    )
  }

  // --- Attempt 1: Dynamic credentials via Metered REST API ---
  // This creates a new credential each time, which can expire automatically.
  // Requires the correct app subdomain (e.g., "myapp" → myapp.metered.live).
  // We try common patterns; if none work, fall back to static credentials.
  const appId = process.env.METERED_APP_ID // e.g., "69fe57839a8f12270ae7a5ec"

  const dynamicResult = await tryDynamicCredentials(secretKey, appId)

  if (dynamicResult) {
    return NextResponse.json({ iceServers: dynamicResult, source: 'dynamic' })
  }

  // --- Fallback: Static credentials from .env.local ---
  // These work but don't expire — rotate them from the dashboard periodically.
  const iceServers = [
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: `turn:${region}.relay.metered.ca:80`,
      username: staticUsername,
      credential: staticCredential,
    },
    {
      urls: `turn:${region}.relay.metered.ca:80?transport=tcp`,
      username: staticUsername,
      credential: staticCredential,
    },
    {
      urls: `turn:${region}.relay.metered.ca:443`,
      username: staticUsername,
      credential: staticCredential,
    },
    {
      urls: `turns:${region}.relay.metered.ca:443?transport=tcp`,
      username: staticUsername,
      credential: staticCredential,
    },
  ]

  return NextResponse.json({ iceServers, source: 'static' })
}

/**
 * Try to create a dynamic TURN credential via the Metered REST API.
 * Returns ICE servers array on success, null on failure.
 */
async function tryDynamicCredentials(
  secretKey: string,
  appId?: string
): Promise<Array<{ urls: string; username?: string; credential?: string }> | null> {
  // Possible app subdomain patterns to try
  const candidates = appId ? [appId] : []

  for (const appSubdomain of candidates) {
    try {
      const endpoint = `https://${appSubdomain}.metered.live/api/v1/turn/credential`

      const res = await fetch(`${endpoint}?secretKey=${secretKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'songshare-dynamic' }),
        signal: AbortSignal.timeout(5000),
      })

      if (!res.ok) continue

      const data = await res.json()
      const { username, credential, apiKey } = data

      if (!username || !credential) continue

      // Now fetch the full ICE servers array using the apiKey
      const region = process.env.METERED_TURN_REGION || 'global'
      const credsRes = await fetch(
        `${endpoint}s?apiKey=${apiKey}&region=${region}`,
        { signal: AbortSignal.timeout(5000) }
      )

      if (credsRes.ok) {
        const servers = await credsRes.json()
        if (Array.isArray(servers) && servers.length > 0) {
          console.log('[TURN] Dynamic credentials obtained from', appSubdomain)
          return servers
        }
      }

      // If get-credential fails, build ICE servers manually from username/credential
      return [
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: `turn:${region}.relay.metered.ca:80`, username, credential },
        { urls: `turn:${region}.relay.metered.ca:80?transport=tcp`, username, credential },
        { urls: `turn:${region}.relay.metered.ca:443`, username, credential },
        { urls: `turns:${region}.relay.metered.ca:443?transport=tcp`, username, credential },
      ]
    } catch {
      // Try next candidate
    }
  }

  return null
}
