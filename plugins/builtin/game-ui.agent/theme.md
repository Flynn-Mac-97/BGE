# The theme

- The game's stylesheet is `assets/ui/theme.css`. It is read when a level loads and again when the file changes. No file means the defaults.
- It is ordinary CSS. Write `:root { --ui-accent: #ff0066 }` for tokens (`:root` becomes `:host` inside a panel) and any selector for the rest: `.ui-button:hover { ... }`, `.enemy-tag { ... }`.
- The kit's rules come first, then the theme, then a panel's own `css`, then an element's `style`. Later wins.
- Tokens: `ink quiet surface edge accent on-accent track scrim outline good danger trail font size radius space`.
- Screen and the HUD read `ink quiet surface edge accent track scrim outline` from the same tokens, so give those plain colours (no `var()`).
- Styling hooks on every control: `[data-focus]` (keyboard focus), `[data-selected]`, `[data-disabled]`, `[data-kind]`, `[data-tone]`.
- Classes: `ui-stack ui-row ui-grid ui-scroll ui-panel ui-button ui-toggle ui-field ui-slider ui-select ui-input ui-tabs ui-tab ui-bar ui-slot ui-badge ui-list ui-row-item ui-tip ui-modal ui-toast ui-anchor`.
- `gameUi.theme.use(cssText)` sets a theme from code (kept across levels). `.load('ui/parchment.css')` reads another asset. `.tokens()` answers what is in force.
