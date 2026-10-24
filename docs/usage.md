# Usage tutorial

This tutorial uses close-gate and verify-gate in a repository you already trust.
Install both mods with [Installation](installation.md).

## See the close facts

1. Start an interactive Claude Code session in your repository.
2. Wait for the first close-gate collection.
3. Run `/closeok`.
4. Read the Git counts, development ports, claim, and open-item count.

The collector refreshes once a minute. These facts do not approve a commit or deployment.
A clean result does not prove that tests passed.

## Select a repository check

Create `.claude/verify.json` in the repository:

```json
{
  "command": ["npm", "test", "--silent"],
  "timeoutSec": 120,
  "match": ["src/**", "package.json"]
}
```

Use a command that is valid for your repository.
The mod runs this command as your user, with the repository root as its working folder.
The array is a program and its arguments. It is not a shell expression.

1. Run `/verify` to schedule the check.
2. Read the result in the band or footer.
3. If the check fails, run `/verify log` to read the last output.
4. Fix the cause of the failure.
5. Run `/verify` again.

After a turn edits a matching file, verify-gate schedules the check automatically.
Run `/verify off` to stop automatic checks in the current session.
Run `/verify on` to enable them again.

## Try the other commands

- Run `/waste` to inspect today's repeated commands.
- Run `/ship list` to see output files recorded in the current session.
- Run `/radar` if you have the external session registry.
- Run `/session` in the Code tab of the Claude desktop app to open or close the Session pane.

The [reference](reference/mods.md) explains each command and its limits.
