/**
 * Kernel: where an asset name points, as a path from `project/`.
 *
 * The rule had five copies — the renderer's, node's `check`, and one each in the
 * audio, decals and particles plugins — and nothing kept them in step. When the
 * renderer's copy and node's copy drift, `check` either swears a file is there
 * that the renderer cannot fetch, or reports two hundred missing assets that are
 * all sitting on disk. So the half both sides agree on lives here, alone.
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
 * Which directory under the repository root holds the project.
 *
 * The dev server reads `ENGINE_PROJECT` and declares it here, so the browser
 * fetches from the same directory the server serves. It travels through
 * `import.meta.env` rather than a bare defined identifier because a bare one is
 * only substituted by a production build — Vite's define plugin returns
 * immediately in dev — and a parameter that silently reverts to `project` the
 * moment you actually use the editor is worse than no parameter at all.
 *
 * The `|| {}` is for node, which imports this same file with no bundler
 * anywhere near it. Node is told its project directory as an argument instead,
 * and never asks for a URL.
 */
const environment = import.meta.env || {}
export const PROJECT_DIRECTORY = environment.ENGINE_PROJECT || 'project'

/**
 * The project's own folders. A reference that starts with one of these is
 * project-relative; everything else lives under `assets/`.
 */
const PROJECT_FOLDER = /^(assets|levels|types|behaviours|tests|plugins)\//

/**
 * Where a named file actually lives, as a path from `project/`.
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
  const relative = String(reference).replace(/^\/?project\//, '')
  return PROJECT_FOLDER.test(relative) ? relative : 'assets/' + relative
}

/**
 * The same answer as a URL the browser can fetch.
 *
 * The prefix is the parameter; `engine/index.js` imports `PROJECT_DIRECTORY`
 * from here for the same reason, so the directory is named in one place and the
 * two spellings cannot drift.
 *
 * `assetPath` above still strips a literal leading `project/`, deliberately: it
 * runs in node as well, where there is no define to read, and a rule that
 * answered differently either side of the split is worse than a stale prefix
 * nobody writes.
 */
export const assetURL = source => `/${PROJECT_DIRECTORY}/` + assetPath(source)
