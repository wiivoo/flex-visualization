// Authentication utilities for FlexMon Dashboard

import { SignJWT, jwtVerify } from 'jose'

const SECRET_KEY = process.env.AUTH_SECRET || new TextEncoder().encode('fallback-secret-key-change-in-production')
const SESSION_COOKIE_NAME = 'flexmon-session'
const SESSION_DURATION = 24 * 60 * 60 * 1000 // 24 hours

export async function createSession(password: string): Promise<string> {
  const expectedPassword = process.env.DASHBOARD_PASSWORD

  if (!expectedPassword) {
    throw new Error('DASHBOARD_PASSWORD nicht konfiguriert')
  }

  if (password !== expectedPassword) {
    throw new Error('Ungültiges Passwort')
  }

  const secret = typeof SECRET_KEY === 'string' ? new TextEncoder().encode(SECRET_KEY) : SECRET_KEY

  const token = await new SignJWT({ authenticated: true, timestamp: Date.now() })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .sign(secret)

  return token
}

export async function verifySession(token: string): Promise<boolean> {
  try {
    const secret = typeof SECRET_KEY === 'string' ? new TextEncoder().encode(SECRET_KEY) : SECRET_KEY

    const { payload } = await jwtVerify(token, secret)

    return !!payload.authenticated
  } catch {
    return false
  }
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME
}
