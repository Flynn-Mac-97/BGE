# Trellis, vendored

`audit.mjs` and `config.mjs` are the library build of Trellis 0.2.1
(https://github.com/jayminwest/trellis, commit
45854a59898581c270d459c05dbe1982f2ccbdd0), with the local JavaScript support
conversion. MIT licence, in `LICENSE`.

`scripts/check-structure.mjs` imports them under node, so the kernel gate needs
no bun and no checkout outside this repository. They need the dev dependencies
`typescript` (pinned to 6.0.3, the version Trellis pins), `js-yaml` and `zod`.

Do not edit these files. To update, build the Trellis library again, copy both
files here, and check that `npm run check:structure` reports the same numbers
as before.
