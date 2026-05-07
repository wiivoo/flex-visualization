import { NextRequest, NextResponse } from 'next/server'

const ACCESS_COOKIE_NAME = 'flex_access'
const ACCESS_PATH_PREFIX = '/access/'
const DEFAULT_REDIRECT_PATH = '/v2'
const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60

const encoder = new TextEncoder()

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlDecode(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function signPayload(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return base64UrlEncode(new Uint8Array(signature))
}

async function createSessionCookie(secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    v: 1,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  })))
  const signature = await signPayload(payload, secret)
  return `${payload}.${signature}`
}

async function verifySessionCookie(cookieValue: string | undefined, secret: string) {
  if (!cookieValue) return false

  const [payload, signature] = cookieValue.split('.')
  if (!payload || !signature) return false

  const expectedSignature = await signPayload(payload, secret)
  if (signature !== expectedSignature) return false

  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(payload))
    const session = JSON.parse(decoded) as { exp?: unknown; v?: unknown }
    return session.v === 1 && typeof session.exp === 'number' && session.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

function notFound() {
  return new NextResponse('Not found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

function misconfigured() {
  return new NextResponse('Access gate misconfigured', {
    status: 500,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

function safeRedirectUrl(request: NextRequest, value: string | null) {
  const fallbackUrl = new URL(DEFAULT_REDIRECT_PATH, request.url)

  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith(ACCESS_PATH_PREFIX)) {
    return fallbackUrl
  }

  try {
    const targetUrl = new URL(value, request.url)
    return targetUrl.origin === request.nextUrl.origin ? targetUrl : fallbackUrl
  } catch {
    return fallbackUrl
  }
}

function readAccessToken(pathname: string) {
  if (!pathname.startsWith(ACCESS_PATH_PREFIX)) return null
  const rawToken = pathname.slice(ACCESS_PATH_PREFIX.length)
  try {
    return decodeURIComponent(rawToken)
  } catch {
    return rawToken
  }
}

export async function proxy(request: NextRequest) {
  const accessToken = process.env.ACCESS_TOKEN
  const sessionSecret = process.env.SESSION_SECRET

  if (!accessToken && !sessionSecret) {
    return NextResponse.next()
  }

  if (!accessToken || !sessionSecret) {
    return misconfigured()
  }

  const { pathname, searchParams } = request.nextUrl
  const requestedAccessToken = readAccessToken(pathname)

  if (requestedAccessToken !== null) {
    if (requestedAccessToken !== accessToken) {
      return notFound()
    }

    const redirectUrl = safeRedirectUrl(request, searchParams.get('next'))

    const response = NextResponse.redirect(redirectUrl)
    response.cookies.set(ACCESS_COOKIE_NAME, await createSessionCookie(sessionSecret), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  if (pathname === '/logout') {
    const response = NextResponse.redirect(new URL('/', request.url))
    response.cookies.delete(ACCESS_COOKIE_NAME)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const isAuthorized = await verifySessionCookie(request.cookies.get(ACCESS_COOKIE_NAME)?.value, sessionSecret)
  if (!isAuthorized) {
    return notFound()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
