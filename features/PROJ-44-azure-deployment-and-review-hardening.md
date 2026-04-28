# PROJ-44 - Azure Deployment & Review Hardening

## Summary

Tighten the repository so an external engineer can understand, validate, and deploy the live application without relying on historical context or Vercel-only workflow knowledge.

## Goals

- Add reviewer-facing documentation that explains the live runtime shape, major entrypoints, and external dependencies.
- Add Azure-friendly deployment assets so the repository can be validated and deployed from Azure-only tooling.
- Keep product behavior unchanged while improving maintainability and operational clarity.

## Scope

- Root documentation refresh where needed
- External review guide
- Azure deployment guide
- Production Dockerfile and Docker build hygiene
- Baseline Azure Pipelines YAML
- Repo validation cleanup so standard lint targets the live application rather than historical/research-only assets

## Non-Goals

- Changing product calculations or UI behavior
- Migrating production traffic in this task
- Adding Azure resource names, credentials, or subscription-specific deployment steps

## Acceptance Criteria

- `README.md` explains that the app is a Next.js server app with API routes and Node runtime needs.
- The repo contains a production-ready `Dockerfile` and `.dockerignore`.
- The repo contains an `azure-pipelines.yml` that validates install, lint, build, and container build paths.
- `docs/review/` contains a guide an external reviewer can use to audit the live codebase.
- `docs/deployment/` contains an Azure App Service runbook for this repository.
- `npm run lint` and `npm run build` complete without lint errors in the live app codepath.

## Key Files

- `README.md`
- `.env.local.example`
- `CHANGELOG.md`
- `eslint.config.mjs`
- `next.config.ts`
- `Dockerfile`
- `.dockerignore`
- `azure-pipelines.yml`
- `docs/review/external-review-guide.md`
- `docs/deployment/azure-app-service.md`
