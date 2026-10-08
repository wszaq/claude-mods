# claude-mods

Custom Claude Code mods (function-hook plugins) for the Mac and the ThinkPad. The spec and the evidence for each mod: `docs/Projects/claude-workflow-mods/2026-10-09-work-profile-and-top5-mods.md` in `_WAJBKODING`.

| Mod | What it does |
|---|---|
| `close-gate` | A band shows if the session is ready to close. The `running_state` tool gives the handoff the same facts in one call. |
| `waste-alarm` | A toast when one Bash command repeats too often in a day. `token-dashboard` tips show in the session. |
| `verify-gate` | Runs the repo's checks after a turn that edited files and shows pass or fail. |
| `peer-radar` | The live sessions, claims and sync state of both machines on one board. `/relay` sends a message to a session on either machine. |
| `deliverable-dock` | `/ship` copies the session's latest deliverable to Downloads and opens it. |

## Install (each machine, once)

This folder is a plugin marketplace. Each machine adds its own clone:

```bash
claude plugin marketplace add ~/_WAJBKODING/repos/claude-mods
```

On the ThinkPad the path is `~/Work/_WAJBKODING/repos/claude-mods`. Then install each mod at the user scope, for example:

```bash
claude plugin install close-gate@claude-mods
```

A folder marketplace is read from the folder itself. After a `git pull`, run `/reload-plugins`.

## Check

Run `claude plugin validate <mod>` and `claude plugin test <mod>` for each mod.
