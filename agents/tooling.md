# CLI and tool work

- Read-only commands must work without a browser.
- Keep JSON output small and stable.
- Exit `0` for success, `1` for failure, and `2` when no editor is attached.
- Use the browser only to inspect drawing or live editor state.
- Use git only in the CLI layer.
