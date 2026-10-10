# Security policy

The current source branch receives security fixes. No older version has a separate support commitment.

## Report privately

Use GitHub's private vulnerability report if the repository offers that option.
Open the Security tab, select Advisories, and select Report a vulnerability.
If the option is unavailable, request a private contact route from the maintainer and omit exploit details.
Do not put credentials, session logs, private hostnames, or an exploit in a public issue.

Include the mod version, Claude Code version, platform, impact, and reproduction steps in the private report.
The maintainer will review the report. This project has no guaranteed response time.

## Trust boundaries

These plugins run processes as your user through Claude Code.
Verify-gate runs commands selected by your repository.
Peer-radar can contact an explicitly configured SSH host and fetch explicitly configured Git repositories.
Relay sends a real registry announcement.
Deliverable-dock copies files to Downloads and opens them only when you select an action.

Waste-alarm stores normalized shell commands locally. Arguments can contain private data.

Review repository checks and plugin configuration before use.
Do not publish local stores or Token Dashboard databases.
The MIT license does not cover Claude Code or external tools.
