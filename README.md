# claude-mods

Six Claude Code function-hook plugins for local development on macOS and Linux.
A mod observes session events and adds commands, status text, or a user interface.

## What it is

claude-mods is a Claude Code marketplace with six plugins. Each plugin is a mod.
A mod observes session events. It adds commands, status text, or a user interface to the session.

The main features run locally. They do not call a model API or require a cloud account.
Repository checks can run commands and contact services that your project selects.

## Quick start

Requirements:

- macOS or Linux with Git.
- Claude Code with function-hook support. Use version 2.1.293 or later for the verify-gate failure note.
- Windows is not supported by the current process commands.

These plugins use the `claude-code` runtime API. They do not run in Codex or Claude Desktop.
The exception is `session-panel`. It draws its pane in the Code tab of the Claude desktop app.

Clone the repository and add it as a marketplace:

```bash
git clone https://github.com/wszaq/claude-mods.git
cd claude-mods
claude plugin marketplace add "$PWD"
claude plugin install close-gate@claude-mods
```

Start a new Claude Code session. Run `/closeok` to see the cached close facts.
Follow [Installation](docs/installation.md) to install the other mods or update them.

## Usage

| Mod | Purpose | Command |
| --- | --- | --- |
| close-gate | Show Git changes, development ports, and optional session claims | `/closeok [tips\|dismiss]` |
| waste-alarm | Count repeated shell commands and show optional Token Dashboard tips | `/waste` |
| verify-gate | Run repository checks after a turn that edits files | `/verify-gate` |
| peer-radar | Show optional local and SSH peer session boards and repository sync state | `/radar`, `/relay` |
| deliverable-dock | Record output files and copy a selected file to Downloads | `/ship` |
| session-panel | Show the task list, files made for you, connectors, subagent tokens and prices, and a mod switchboard in one pane | `/session-panel` |

verify-gate runs one repository check after a turn that edits files. See the [mod reference](docs/reference/mods.md) for how it chooses the check.
Run `/verify-gate off` to stop automatic checks in the current session. Run `/verify-gate on` to enable them again.

For a step-by-step tutorial, read the [Usage tutorial](docs/usage.md).
The [mod reference](docs/reference/mods.md) lists each command and its limits.

- [Installation and updates](docs/installation.md)
- [Usage tutorial](docs/usage.md)
- [Reference for all six mods](docs/reference/mods.md)
- [Architecture and local data](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
- [GitHub Wiki](https://github.com/wszaq/claude-mods/wiki)

## Configuration

This repository does not read environment variables.
Each mod reads its options from its plugin settings. Show the options of an installed mod with
`claude plugin configure peer-radar@claude-mods`. Reload the plugins after a change.

| Mod | Option | Default | Meaning |
| --- | --- | --- | --- |
| peer-radar | `peerHost` | Empty | SSH host or alias. Empty and `off` disable SSH. |
| peer-radar | `repos` | Empty | Comma-separated repository paths to inspect. |
| waste-alarm | `threshold` | `10` | Daily count that triggers one toast per command. |
| waste-alarm | `tokenDashboard` | Empty | Path to a Token Dashboard clone. Empty means auto-detect. |
| deliverable-dock | `extensions` | `.pdf,.pptx,.docx,.xlsx,.html,.png,.jpg,.mp4,.mov,.zip` | Comma-separated file types to record. |

verify-gate reads a file named .claude/verify.json in your repository. Its keys are:

- `command`: a string array. It holds the program and its arguments. The mod does not use a shell.
- `timeoutSec`: the timeout in seconds. The default is 120. The maximum is 600.
- `match`: glob patterns that select the edited files that start a check. The default is all files.

```json
{
  "command": ["npm", "test", "--silent"],
  "timeoutSec": 120,
  "match": ["src/**", "package.json"]
}
```

The mods keep local data in folders under your home directory. See [Architecture and local data](docs/architecture.md).

### Optional integrations

Some features need tools that this repository does not supply:

- close-gate can read an existing session claim under `~/.claude/session-claims/`.
- peer-radar needs `~/.claude/hooks/session-register.py` for session boards and relay messages.
- peer-radar can show an existing Linux `sh-vault-stable-sync` service.
- waste-alarm can read tips from [Token Dashboard](https://github.com/wszaq/token-dashboard).
- verify-gate can use an existing `~/.claude/skills/plain-language/plain-check.py` checker.

Missing tools do not supply the corresponding feature.
See [the reference](docs/reference/mods.md) before you enable an integration.

## Layout

- `.claude-plugin/marketplace.json`: the marketplace manifest that lists the six plugins.
- `close-gate/`, `waste-alarm/`, `verify-gate/`, `peer-radar/`, `deliverable-dock/`, `session-panel/`: one plugin each.
  Each plugin folder has a plugin manifest, a hooks folder with the source and tests, and a types folder.
  For example, `close-gate/hooks/register.tsx` registers the close-gate band.
- `docs/`: the canonical documentation. The `docs/wiki/` folder holds the source for the GitHub Wiki.
- `learning-base/`: dated journal entries about the work on these mods.
- `LICENSE` and `NOTICE`: the MIT license and the third-party notice. The notice credits the critter.mjs code from Nate Herk.
- `CONTRIBUTING.md` and `SECURITY.md`: the contribution guide and the security policy.

## Status

The current source branch receives security fixes.
Version 2.1.311 passed the repository tests. Tests also passed on Claude Code 2.1.295.

Run these checks from the repository root before and after a change:

```bash
for mod in close-gate waste-alarm verify-gate peer-radar deliverable-dock session-panel; do
  claude plugin validate "$mod" || exit 1
  claude plugin test "$mod" || exit 1
done
```

The source code uses the [MIT license](LICENSE). Claude Code remains a separate product.
To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, read [SECURITY.md](SECURITY.md).
