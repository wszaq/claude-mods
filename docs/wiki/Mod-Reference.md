# Mod reference

## close-gate

`/closeok` shows cached facts. The `mcp__close-gate__running_state` tool returns the same facts.
The collector reads Git status, extra worktrees, listening ports, and optional session records every 60 seconds.
The port list is machine-wide and includes at most five recognized development processes.
The band appears when one of its counts is nonzero. Hide uses hotkey `x`.

If present, claim files use `~/.claude/session-claims/<session-id>.json` and the matching Markdown file.
The mod counts every `- [ ] ` line in that Markdown file.
Close-related English prompts can receive a facts block of at most 1,200 characters.
The `session-handoff` skill receives a hint to call the facts tool.
There are no user options.

## waste-alarm

| Command | Result |
| --- | --- |
| `/waste` | Open tips and the ten most repeated commands today |
| `/waste ignore <prefix>` | Add a persistent command prefix to the ignore list |
| `/waste dismiss` | Dismiss the current tips |

| Option | Default | Meaning |
| --- | --- | --- |
| `threshold` | `10` | Daily count that triggers one toast per command |
| `tokenDashboard` | Empty | Path to a Token Dashboard clone |

The mod normalizes the first segment of a Bash command.
It ignores common inspection commands such as `git status`, `ls`, and `cat`.
Counts use the local calendar day. Interactive startup removes count keys older than seven days.
Headless sessions can count commands, but they do not scan, show toasts, or remove old keys.

Token Dashboard tips are optional. Configure its clone path for a portable setup.

Legacy detection also checks `_WAJBKODING/repos/token-dashboard` and `Work/_WAJBKODING/repos/token-dashboard` under your home folder.
The mod runs `cli.py scan` and `cli.py tips` with a separate database:
`~/.claude/mods-data/waste-alarm/token-dashboard.db`.

It checks tips after 30 seconds and every two hours. A shared timestamp limits scans to once per 100 minutes.
Dismissed tip titles remain dismissed when their numeric counts change.
The tips button uses `w`. Dismiss uses `d`.

## verify-gate

| Command | Result |
| --- | --- |
| `/verify` | Schedule a repository check |
| `/verify log` | Show the last 60 output lines |
| `/verify off` | Disable checks and cancel active checks |
| `/verify on` | Enable checks |

The mod records successful Edit, Write, and NotebookEdit paths.
After a top-level interactive turn, it groups those paths by Git repository.
It chooses one check per repository in this order:

1. `.claude/verify.json` with a nonempty string array named `command`.
2. An edited Python test, or a neighboring `test_<filename>.py` file.
3. `npm test --silent` if `package.json` defines a useful test script.
4. `python3 -m pytest -q -x` if pytest configuration exists.

Explicit configuration supports `match` globs and `timeoutSec`.
The default timeout is 120 seconds. The maximum is 600 seconds.
An invalid explicit configuration supplies no check and prevents automatic fallback.
The command runs without a shell. Configure `sh -c` explicitly only if your project needs it.

A new check cancels an older check for the same repository.

A failed check shows a band with log (`l`) and rerun (`r`) buttons.
On supported engines, a distinct failure appends one user note with the last 15 output lines.
The log buffer retains at most 65,536 characters.
If the optional plain-language checker exists, Markdown files also get advisory flags.
These flags do not fail the repository check. There are no user options.

## peer-radar

| Command | Result |
| --- | --- |
| `/radar` | Open the board with a Refresh button |
| `/relay <short-id> <text>` | Send a registry announcement to a cached local or peer session |

| Option | Default | Meaning |
| --- | --- | --- |
| `peerHost` | Empty | SSH host or alias; empty and `off` disable SSH |
| `repos` | Empty | Comma-separated repository paths to inspect |

Session boards and relay need an external `~/.claude/hooks/session-register.py` on each selected machine.
This repository does not install that script. Without it, the board shows an error.
The parser expects columns named STATE, ID, KIND, WORKSPACE, AGE, MAIL, NAME, and CLAIM.

Collection starts after five seconds and repeats every two minutes.
SSH uses batch mode and a five-second connection timeout.
Configured repositories can receive `git fetch -q`, at most once per ten minutes across sessions.
The mod reads upstream counts and uncommitted paths. It does not commit or merge.
The mod omits repositories without an upstream.

An optional vault row reads the Linux user service `sh-vault-stable-sync` and its recent journal.
On macOS, this row uses the configured SSH peer. The service is not included here.
Relay is a real message operation through the external registry. Use it only for a message you intend to send.

## deliverable-dock

| Command | Result |
| --- | --- |
| `/ship` | Copy the most recent recorded file to Downloads and open it |
| `/ship <number>` | Copy the selected numbered file and open it |
| `/ship list` | Open the file list |

The `extensions` option defaults to:
`.pdf,.pptx,.docx,.xlsx,.html,.png,.jpg,.mp4,.mov,.zip`.
Use a comma-separated list to select other file types.
Successful Write calls can record a file. Successful Bash calls can record matching command tokens.
For Bash, the file must exist and have a modification time within the last two minutes.

The list retains the latest 30 paths in the current session.
It does not scan the repository for older files.

Ship creates Downloads if necessary. If the destination exists, Ship uses a numbered suffix.
Open uses `open` on macOS or `xdg-open` on Linux.

The pane also offers Reveal and Copy path.
The band offers ship (`s`), open (`o`), and dismiss (`n`).
Ship means a local copy. It does not upload or email the file.

## session-panel

| Command | Result |
| --- | --- |
| `/session` | Open or close the Session pane |

The pane opens at session start. A pane that opens without a command needs a wide window.
In a narrow window, run `/session`.

The pane has five cards. Each card opens or closes with its title, and keeps that state across sessions.

- **Progress** shows the task list of the Claude Code desktop app (`update_plan`).
  A `wrap_up` call marks all steps as done. Subagent calls do not change the list.
- **Outputs** lists the files of successful Write, Edit, and NotebookEdit calls, newest first.
  The list keeps 100 paths. Scratchpad and `/tmp/` files are dim.
  A click opens the file in the desktop Files pane. The app opens only files in the working
  directory or a granted folder. Other files show a toast with the reason.
- **Used** shows one chip for each MCP server, skill, Web search, and Web fetch that the session used.
  The card does not show app servers (`ccd_*`) or servers that have an ID as their name.

- **Subagents** shows one row for each Agent call: its description, model, tokens, and time,
  and a bar that compares its tokens with the largest agent. A background agent shows "running"
  until its turn ends. Then the card adds the tokens and time of that turn.
- **Mods** lists the mods of the `claude-mods` and `nateherk-mods` marketplaces from the user
  `enabledPlugins` setting. A click runs `claude plugin enable` or `claude plugin disable`.
  The change applies to new sessions. The list does not show `session-panel`.

The pane shows only the current session. It does not read other sessions or the transcript file.
It starts empty after the mod loads, because it counts only tool calls that it sees.

---

Canonical source: [docs/reference/mods.md](https://github.com/wszaq/claude-mods/blob/main/docs/reference/mods.md).
Maintain the repository document first. Copy its updates to this wiki page before publication.
