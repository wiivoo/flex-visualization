# Project Context

## Tech Stack

- **Framework:** Next.js 16.1.1 (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + Storage)
- **Package Manager:** npm

## Folder Structure

```
src/
  app/          Next.js App Router pages and layouts
  components/   React components
  hooks/        Custom React hooks
  lib/          Utilities (supabase.ts, utils.ts)
public/         Static assets
```

## Environment Variables

Create a `.env.local` file in the project root:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

Get these from your Supabase project settings: https://supabase.com/dashboard/project/_/settings/api

## Next Steps

1. Set up your Supabase project at https://supabase.com
2. Add environment variables to `.env.local`
3. Run `npm run dev` to start development
4. Build features using the `/requirements` → `/architecture` → `/frontend` → `/backend` → `/qa` workflow
