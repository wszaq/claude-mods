# Architecture and local data

## Layout

The marketplace manifest is `.claude-plugin/marketplace.json`.
Each mod has a manifest, a hook module, tests, and type declarations:

```text
<mod>/
  .claude-plugin/plugin.json
  hooks/hooks.json
  hooks/register.tsx
  hooks/register.test.ts or register.test.tsx
  types/index.d.ts
```

Claude Code supplies the `claude-code` runtime and test API.
There is no standalone Node server or package installation in this repository.
Git ignores runtime-generated `.claude-plugin/types/` folders.

## Events and state

Each module exports `register`. The module registers handlers for session, tool, command, and UI events.
The mods use runtime atoms for session state. Waste-alarm and peer-radar also use the plugin store.
Bands call the next UI handler before they add their own row.
This lets multiple bands appear together.

The mods disable automatic collectors, scans, checks, and deliverable records in headless sessions.
Waste-alarm still counts Bash commands in headless sessions.
Unit tests verify these behaviors with the Claude Code test runtime.

## Data boundaries

Close-gate reads Git and process facts. It can read session claim files.
Waste-alarm stores normalized command text and counts, ignore prefixes, and dismissed tip titles.
Command text can contain private arguments. Treat the local plugin store as private data.
Its optional Token Dashboard database stays under `~/.claude/mods-data/`.

Verify-gate runs project commands and retains recent output in session state.
Peer-radar reads boards, repository facts, and optional service logs.
A configured SSH host receives registry commands. A configured repository can contact its Git remote through fetch.
Deliverable-dock stores local paths in session state and copies selected files to Downloads.

No mod has its own telemetry endpoint or model API call.
A project check, SSH command, or optional external tool can have its own network behavior.

## Limits

The close facts are a snapshot. They are not a release approval or a security audit.
Verify-gate selects one check per repository. It does not replace a project's required CI checks.
Peer-radar depends on an external registry with a specific table format.

Deliverable detection uses Write events and Bash tokens. It cannot detect every file operation.

---

Canonical source: [docs/architecture.md](https://github.com/wszaq/claude-mods/blob/main/docs/architecture.md).
Maintain the repository document first. Copy its updates to this wiki page before publication.
