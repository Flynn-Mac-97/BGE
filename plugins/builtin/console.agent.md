---
description: The engine's own view of the instances a shell or host is running, and which one is on screen. Use when the Console panel is empty, when an instance does not appear, or to switch between running instances without leaving the engine window.
category: authoring
---

# Console

- The desktop console is outside game views so reloads do not close terminals.
- Use Terminal for shells and installed agents, Activity for events, and Instances for process controls.
- `console.instances` reads `/api/desktop`: `supported`, `active`, and the supervisor instance records.
- A browser without a desktop host returns `supported: false` and an empty list.
- Use `node bin/engine.mjs desktop <action> [json]` to control the desktop from a terminal. `desktop snapshot` lists sessions and providers.
