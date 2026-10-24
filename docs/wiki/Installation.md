# Installation and updates

## Requirements

Use macOS or Linux with Git and Claude Code function-hook support.
Use Claude Code 2.1.293 or later for failure notes. Tests passed on 2.1.295.
Windows is not supported by the current process commands.

Install these programs for the features you select:

| Program | Feature |
| --- | --- |
| `git`, `uname` | Git checks and platform detection |
| `lsof` | Development ports in close-gate |
| `ss` | Linux port fallback when lsof cannot run |
| `python3` | Python checks, optional session boards, and Token Dashboard |
| `npm` | JavaScript project checks |
| `open` on macOS, `xdg-open` on Linux | Open deliverables |
| `cp`, `mkdir` | Copy deliverables to Downloads |
| `ssh` | An explicitly configured peer host |

## Install selected mods

Clone the repository into a folder that you control:

```bash
git clone https://github.com/wszaq/claude-mods.git
cd claude-mods
claude plugin marketplace add "$PWD"
```

Install one mod:

```bash
claude plugin install verify-gate@claude-mods
```

Or install all six mods:

```bash
for mod in close-gate waste-alarm verify-gate peer-radar deliverable-dock session-panel; do
  claude plugin install "$mod@claude-mods"
done
```

Start a new session or run `/reload-plugins`.
Review the plugin permissions and project trust prompts that Claude Code shows.

## Configure a mod

Show the options for an installed mod:

```bash
claude plugin configure peer-radar@claude-mods
```

Save a peer host and a repository list:

```bash
printf '%s\n' '{"peerHost":"my-peer","repos":"~/projects/example"}' | claude plugin configure peer-radar@claude-mods --values-stdin
```

Use an SSH alias from your own configuration. Both machines need the external session registry for boards and relay.
Leave `peerHost` empty or use `off` to disable SSH.
Reload the plugins after a configuration change.
See [Reference](https://github.com/wszaq/claude-mods/blob/main/docs/reference/mods.md) for the available options.

## Update

Installed plugins are cached copies. An edit in the clone does not change an installed plugin.
The changed plugin needs a new manifest version before its cache can update.

```bash
git pull --ff-only
claude plugin marketplace update claude-mods
```

Update each installed mod:

```bash
for mod in close-gate waste-alarm verify-gate peer-radar deliverable-dock session-panel; do
  claude plugin update "$mod@claude-mods"
done
```

Start a new session or run `/reload-plugins`.

## Settings shared between machines

A folder marketplace can save an absolute path in `settings.json`.
That path must exist on each machine that uses the settings.
Use a local clone and symlink on each machine if you share settings.
Do not copy another user's machine path.

## Disable or remove a mod

```bash
claude plugin disable verify-gate@claude-mods
claude plugin uninstall verify-gate@claude-mods
```

Disable stops the mod after reload. Uninstall removes its installed plugin entry.
Do not delete shared Claude settings or the whole plugin cache.

---

Canonical source: [docs/installation.md](https://github.com/wszaq/claude-mods/blob/main/docs/installation.md).
Maintain the repository document first. Copy its updates to this wiki page before publication.
