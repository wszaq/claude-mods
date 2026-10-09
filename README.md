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

`~/.claude/settings.json` syncs between the Mac and the ThinkPad, so the marketplace must use a path that is the same on both: `~/.claude/claude-mods`. That path is a symlink, local to each machine (`~/.claude/.gitignore` ignores it), to the machine's own clone.

1. Clone this repo: `~/_WAJBKODING/repos/claude-mods` on the Mac, `~/Work/_WAJBKODING/repos/claude-mods` on the ThinkPad.
2. Make the symlink: `ln -s <clone> ~/.claude/claude-mods`.
3. Register the marketplace and install the mods at the user scope:

```bash
claude plugin marketplace add ~/.claude/claude-mods
```

```bash
for m in close-gate waste-alarm verify-gate peer-radar deliverable-dock; do claude plugin install $m@claude-mods; done
```

4. `marketplace add` writes the expanded absolute path into `settings.json`. Change it back to `"path": "~/.claude/claude-mods"` (as for `nateherk-mods`), or the other machine gets a path that does not exist.

## Update (after a code change or a `git pull`)

The installed mods are copies made at install time, in `~/.claude/plugins/cache/claude-mods/<mod>/<version>/`. A change in the clone does nothing until you update them, and the update does nothing without a new version.

1. Bump `version` in each changed `<mod>/.claude-plugin/plugin.json` and push.
2. On each machine, after `git pull`:

```bash
claude plugin marketplace update claude-mods
```

```bash
for m in close-gate waste-alarm verify-gate peer-radar deliverable-dock; do claude plugin update $m@claude-mods; done
```

3. Make sure that `settings.json` still has `"path": "~/.claude/claude-mods"`. Then open a new session or run `/reload-plugins`.

Claude Code 2.1.293 or later. On 2.1.292, verify-gate cannot add its failure note (no `session.append`); the band still shows the failure.

## Check

Run `claude plugin validate <mod>` and `claude plugin test <mod>` for each mod.
