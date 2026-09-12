# Size — the reader is an agent, and it pays per line

- The guide must answer "what is this for" and "how do I drive it" without opening the `.js`.
- Keep a plugin under **400 lines** and its guide under **3000 characters**. Over either, finding one part costs more than the change is worth.
- `node bin/engine.mjs --headless run plugin.sizes` names every plugin that is over, every guide that is over, every plugin missing a guide, and every builtin whose **code** mentions the game's own title. Comments may name the game; code naming it means it is in the wrong folder.
- Split a plugin by what it owns, not by file length. `World Look` became Skybox, View 3D and Gizmo 3D because they were three jobs, and each is now readable on its own.
- Split a guide by the question it answers. One topic is one file in `<plugin>.agent/`, named for the question: `every-key.md`, `commands.md`, `troubleshooting.md`. An agent reads the index and opens one.
- A guide over the limit is usually a table or a worked example, and those are the first things to move.
- Everything is a plugin, so splitting one costs nothing structural — a new file, a `name`, and `needs:` if it depends on another's `context` key.
- Big is not a bug to fix on sight. It is a signal the file holds more than one job. Split when you are already there for another reason.
