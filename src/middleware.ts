import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

// Name of the session cookie set by POST /api/auth (see src/lib/auth.ts).
const SESSION_COOKIE_NAME = 'flexmon-session'

function getSecret(): Uint8Array {
  const raw =
    process.env.AUTH_SECRET ||
    process.env.DASHBOARD_SESSION_SECRET ||
    'fallback-secret-key-change-in-production'
  return new TextEncoder().encode(raw)
}

/**
 * Edge middleware — gates `/management/*` behind the `flexmon-session` JWT.
 *
 * Unauthenticated requests are 307-redirected to `/login?redirect=<pathname>`
 * (matching the `?redirect=` convention the login page consumes). Authenticated
 * requests fall through via `NextResponse.next()`.
 *
 * Note: `/v2` is intentionally NOT gated here to preserve existing behaviour
 * (historically open per this app's middleware config). Adding it would be a
 * separate, intentional change.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value

  const loginUrl = new URL('/login', req.url)
  loginUrl.searchParams.set('redirect', req.nextUrl.pathname)

  if (!token) {
    return NextResponse.redirect(loginUrl)
  }

  try {
    const { payload } = await jwtVerify(token, getSecret())
    if (!payload?.authenticated) {
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  } catch {
    return NextResponse.redirect(loginUrl)
  }
}

export const config = {
  matcher: [],
}
