/**
 * Kernel: where an asset name points, as a path from `project/`.
 *
 * The rule had five copies — the renderer's, node's `check`, and one each in the
 * audio, decals and particles plugins — and nothing kept them in step. When the
 * renderer's copy and node's copy drift, `check` either swears a file is there
 * that the renderer cannot fetch, or reports two hundred missing assets that are
 * all stored on disk. So the half both sides agree on is stored here, alone.
 *
 * This is the mirror image of `engine/project-index.mjs`, which says at its top
 * that nothing in the browser half may import it. BOTH HALVES MAY IMPORT THIS
 * ONE, and that is the whole reason it is a file: it is pure. No DOM, no
 * `node:` import, nothing read off disk.
 *
 * Both spellings live here, the path and the URL, so a plugin that only wants
 * to name a file never has to import `engine/ui.js` to get one. Audio, decals
 * and particles are loaded headless as well as in the browser, and importing
 * the DOM vocabulary for one string would make "ui.js touches no DOM at module
 * scope" a rule the headless world depended on and nobody had written down —
 * and breaking it fails silently, because the plugin loader catches the import
 * and carries on with that plugin missing.
 */

/**
 * The one name for the open project.
 *
 * It is both the URL the browser fetches from and the prefix that names a
 * project file in a match pattern, a claim or a report. A constant, because the
 * project may be any directory on disk: the dev server maps this URL onto
 * whatever it serves, so nothing in either half has to know where that is.
 */
export const PROJECT_PREFIX = 'project'

/**
 * The project's own folders. A reference that starts with one of these is
 * project-relative; everything else is stored under `assets/`.
 */
const PROJECT_FOLDER = /^(assets|levels|types|behaviours|tests|plugins)\//

/**
 * Where a named file actually is stored, as a path from `project/`.
 *
 * A bare name means `assets/`, because the project is depth 1 and writing
 * `sprite: 'player.png'` should just work. A path is project-relative only when
 * it names one of the project's own folders — so a name with a subfolder in it,
 * which is how a project with two hundred assets stays navigable, still resolves
 * under `assets/`. The old rule was "any name containing a slash is
 * project-relative", and it meant `counter-strike/wall.png` looked for
 * `project/counter-strike/wall.png`: the file was right there under `assets/`
 * and the only symptom was a missing texture.
 */
export const assetPath = reference => {
  const relative = String(reference).replace(new RegExp(`^/?${PROJECT_PREFIX}/`), '')
  return PROJECT_FOLDER.test(relative) ? relative : 'assets/' + relative
}

/**
 * Where the open project is served. The dev server serves it at `/project/`.
 * An exported game plays from any path (an itch.io page is not at a site's
 * root), so its page sets `globalThis.__engineProjectBase` to the project
 * folder beside it before the engine loads.
 */
const projectBase = () => globalThis.__engineProjectBase ?? `/${PROJECT_PREFIX}/`

/** The same answer as a URL the browser can fetch. */
export const assetURL = source => projectBase() + assetPath(source)
