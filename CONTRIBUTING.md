# Contributing

Open an issue before a large behavior change.
Describe the user problem, the expected result, and the smallest example that reproduces it.
Include the operating system, Claude Code version, and mod version.
Remove credentials, private paths, and session content from examples.

## Local checks

Clone the repository. Use Claude Code with function-hook test support.
Run all five validation and test commands from the README before a change.
Add a regression test before a bug fix. Confirm that it fails for the expected reason.
Run all five checks after the change.

The suite uses fixed inputs and scripted assertions. The checks do not need a model judge.

## Source and documentation

Keep changes specific to the issue. Match the existing TypeScript style.
Do not commit generated runtime types or local plugin data.
Update the relevant reference page when behavior changes.
Increase the manifest version when installed behavior changes.

The canonical documentation is in `docs/`.
The files in `docs/wiki/` are the source for the GitHub Wiki.
Copy canonical document updates to those pages before wiki publication.
Use absolute repository links in the wiki copies.
Do not put private deployment details in either location.

## Pull requests

State the problem, the resulting behavior, and the checks you ran.
Include a screenshot for a visible UI change when possible.
If you submit a contribution, you agree to release it under this repository's MIT license.
