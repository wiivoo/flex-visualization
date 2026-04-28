# Changelog

All notable changes to this repository are documented here.

## Unreleased

### Added
- Added a production `Dockerfile` and `.dockerignore` for running the Next.js app as a container.
- Added `azure-pipelines.yml` as a clean Azure Pipelines CI entrypoint for Node and Docker validation.
- Added external-review and Azure deployment runbooks under `docs/`.

### Changed
- Enabled Next.js standalone output for container-friendly production builds.
- Tightened ESLint ignore scope so repo-level linting targets the live application instead of archived and research-only files.
- Expanded the root README and environment example to better explain runtime requirements, secrets, and deployment shape.

## 1.0.1 - 2026-04-21

### Changed
- Removed the unused vulnerable `xlsx` dependency and kept the active Excel export path on `exceljs`.
- Cleaned up repo documentation and aligned package metadata with the actual product.
- Introduced the Larry/Pax/Nolan agent orchestration documentation model for repo collaboration.

### Docs
- Rewrote the README around current product surfaces, setup, routes, and canonical docs.
- Consolidated `.claude` documentation and normalized feature/spec registry documentation.
