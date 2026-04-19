import { redirect } from 'next/navigation'

/**
 * /management has been absorbed into /v2/insights (260419-gkt).
 * Permanent server-side redirect preserves any external links / bookmarks.
 */
export default function ManagementRedirect(): never {
  redirect('/v2/insights')
}
