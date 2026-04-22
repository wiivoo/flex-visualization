# PROJ-41: AI Team Orchestration

## Status: Deployed
**Created:** 2026-04-21
**Last Updated:** 2026-04-21

## Overview

Establish a repository-level AI operating model where the user speaks only to **Larry**, and Larry delegates all substantive work through named AI teammates or starter-kit skills.

The initial staffing model introduces:

- **Larry** as the sole user-facing orchestrator
- **Pax** as the senior researcher for expertise discovery
- **Nolan** as the HR and talent architect for staffing and hiring
- **Mira**, **Soren**, and **Quinn** as named specialists for frontend, backend, and QA

## Goals

- Make delegation explicit and repeatable inside the repository
- Preserve named AI identities so the user can address team members directly
- Reuse the starter-kit agent and skill system instead of inventing a parallel workflow
- Treat skills as tools used by agents, not separate user-facing teammates
- Require a staffing step before new specialists are created

## Operating Model

1. User speaks to Larry
2. Pax determines what expertise is needed
3. Nolan chooses an existing agent and the skills that agent should use, or hires a new teammate
4. Selected specialist executes the work
5. Larry reports back to the user

## Acceptance Criteria

- [x] Larry is documented as the sole user-facing assistant in repo instructions
- [x] Pax exists as a named agent profile in `.claude/agents/`
- [x] Nolan exists as a named agent profile in `.claude/agents/`
- [x] Larry exists as a named agent profile in `.claude/agents/`
- [x] Team roster is documented in `.claude/TEAM.md`
- [x] Shared orchestration rules exist and reference starter-kit agents/skills first
- [x] Hiring rule requires name, persona, identity, and bounded responsibility for every new agent
- [x] Named specialists exist for frontend, backend, and QA
- [x] Agent profiles explicitly permit and encourage relevant skill usage

## Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Root repo behavior and Larry-first operating model |
| `.claude/TEAM.md` | Team roster and delegation sequence |
| `.claude/rules/team-orchestration.md` | Shared routing and hiring rules |
| `.claude/agents/larry.md` | Larry orchestrator profile |
| `.claude/agents/pax.md` | Pax researcher profile |
| `.claude/agents/nolan.md` | Nolan staffing profile |

## Notes

- Existing starter-kit specialists remain reusable: frontend, backend, and QA.
- Existing starter-kit skills remain preferred before hiring new agents.
- This feature changes repository workflow, not application runtime behavior.
