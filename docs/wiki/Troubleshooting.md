# Troubleshooting

## Claude Code does not load a mod

Check the installed list:

```bash
claude plugin list
```

Validate the source from the clone:

```bash
claude plugin validate close-gate
claude plugin test close-gate
```

Check that your Claude Code build supports function-hook modules.
Reload the plugins after installation or configuration changes.

## Source edits do not appear

Installed plugins are copies. A source edit does not update the cache.
Increase the changed plugin's manifest version.
Follow the update steps in [Installation](https://github.com/wszaq/claude-mods/blob/main/docs/installation.md).
Check the marketplace path if your settings came from another machine.

## The band is absent

A band can be empty because it has no facts or no active item.
Close-gate hides the band when all its counts are zero.
Waste-alarm shows a band only for current tips.
Deliverable-dock needs a recorded output file.

Use the slash command shown in [Reference](https://github.com/wszaq/claude-mods/blob/main/docs/reference/mods.md).
Desktop surfaces can show a footer command instead of an AbovePrompt band.
Headless sessions do not start automatic UI work.

## Verify-gate runs no check

Run `/verify on`. Run `/verify`.
Check that the working folder belongs to a Git repository.
Check `.claude/verify.json` for valid JSON and a nonempty `command` array.
Check that automatic edits match its `match` list.

Install the selected command's runtime and dependencies.
Read `/verify log` for failures.

## Peer radar reports an error or no repositories

The external session registry is not included in this repository.
Check its path and permissions before you use the mod.
Configure `repos` if you want sync rows. The default list is empty.

Configure `peerHost` only if you want SSH.
Test your own SSH alias with batch mode before you use it in Claude Code.
Missing upstream branches omit repository rows.
A missing vault service omits the optional vault row.

## Waste tips are absent

Command counts work without Token Dashboard.
Configure `tokenDashboard` with the clone path if you want its tips.
Install the dependencies that Token Dashboard requires.
Its scan runs after 30 seconds and uses a shared scan timestamp.
Dismissed tips do not return until their normalized title changes.

## Ship fails or no file appears

Check that the file extension is in `extensions`.
The mod records files from the current session only.
Bash detection needs a path token and a recently modified file.
Check your Downloads permissions and the platform opener.
A Linux desktop needs `xdg-open` and an application for the file type.

## Report a problem

Follow [CONTRIBUTING](https://github.com/wszaq/claude-mods/blob/main/CONTRIBUTING.md).
Remove private paths, command arguments, logs, and session content from a public report.
Use [SECURITY](https://github.com/wszaq/claude-mods/blob/main/SECURITY.md) for a security issue.

---

Canonical source: [docs/troubleshooting.md](https://github.com/wszaq/claude-mods/blob/main/docs/troubleshooting.md).
Maintain the repository document first. Copy its updates to this wiki page before publication.

## Pull fails after the public release history cleanup

The first public release removed personal network defaults from old commits.
An older clone can have a different history, so `git pull --ff-only` can fail.
Keep that clone and any local edits. Clone the public repository into a new folder:

```bash
git clone https://github.com/wszaq/claude-mods.git claude-mods-public
```

Use the new folder for the marketplace. Copy your own uncommitted changes only after you review them.
Do not merge the old history into the public branch.
