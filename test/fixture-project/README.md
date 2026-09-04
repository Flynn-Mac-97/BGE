# The test fixture project

A whole project on disk, small on purpose, so engine tests exercise the real
index build, the real plugin load and the real level load without depending on
a game.

A test that needs a variant — a declared device, a broken type, an extra level —
writes a temporary project of its own. This one stays fixed, because several
tests read it and a change to suit one of them silently changes the others.

Nothing here is a game. The types are the smallest thing that answers the
question each test asks.
