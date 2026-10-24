# claude-mods

Six Claude Code function-hook plugins for local development on macOS and Linux.
A mod observes session events and adds commands, status text, or a user interface.

| Mod | Purpose | Command |
| --- | --- | --- |
| close-gate | Show Git changes, development ports, and optional session claims | `/closeok` |
| waste-alarm | Count repeated shell commands and show optional Token Dashboard tips | `/waste` |
| verify-gate | Run repository checks after a turn that edits files | `/verify` |
| peer-radar | Show optional local and SSH peer session boards and repository sync state | `/radar`, `/relay` |
| deliverable-dock | Record output files and copy a selected file to Downloads | `/ship` |
| session-panel | Show the task list, files made for you, connectors, subagent tokens and prices, and a mod switchboard in one pane | `/session` |

## Start

Use Claude Code with function-hook support. Version 2.1.295 passed the repository tests.
Version 2.1.293 or later supports the verify-gate failure note through `session.append`.
These plugins use the `claude-code` runtime API. They do not run in Codex or Claude Desktop.
The exception is `session-panel`: it draws its pane in the Code tab of the Claude desktop app.

```bash
git clone https://github.com/wszaq/claude-mods.git
cd claude-mods
claude plugin marketplace add "$PWD"
claude plugin install close-gate@claude-mods
```

Start a new Claude Code session. Run `/closeok` to see the cached close facts.
Follow [Installation](docs/installation.md) to install the other mods or update them.

## Documentation

- [Installation and updates](docs/installation.md)
- [Usage tutorial](docs/usage.md)
- [Reference for all six mods](docs/reference/mods.md)
- [Architecture and local data](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
- [GitHub Wiki](https://github.com/wszaq/claude-mods/wiki)
- [Contribution guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Scope and dependencies

The main features run locally. They do not call a model API or require a cloud account.
Repository checks can run commands and contact services selected by your project.
Peer radar uses SSH only when you configure a host. Its repository list is empty by default.

Some integrations need tools that this repository does not supply:

- `close-gate` can read an existing session claim under `~/.claude/session-claims/`.
- `peer-radar` needs `~/.claude/hooks/session-register.py` for session boards and relay messages.
- `peer-radar` can show an existing Linux `sh-vault-stable-sync` service.
- `waste-alarm` can read tips from [Token Dashboard](https://github.com/wszaq/token-dashboard).
- `verify-gate` can use an existing `~/.claude/skills/plain-language/plain-check.py` checker.

These integrations are optional. Missing tools do not supply the corresponding feature.
See [the reference](docs/reference/mods.md) before you enable an integration.

## Checks and license

Run the deterministic checks from the repository root:

```bash
for mod in close-gate waste-alarm verify-gate peer-radar deliverable-dock session-panel; do
  claude plugin validate "$mod" || exit 1
  claude plugin test "$mod" || exit 1
done
```

The source code uses the [MIT license](LICENSE). Claude Code remains a separate product.
