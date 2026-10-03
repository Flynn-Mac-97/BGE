# The Last Lantern prototype

A permanent company of unlikely adventurers rests at a tavern. Deploy one member at a time. The interface remains monochrome; story text explains each decision. This is a provisional eight-room expedition, not a balance pass.

Start with 3 coin. Hire Rook (dagger), Nettle (dagger and healing salve), or Pip (dagger and Storm Totem). Arrange equipment and fight through the cellars. Every fourth room offers an item. Other victories provide salvage. Return between fights to keep equipment, convert expedition scrap to company coin, and earn one experience per cleared room. The eighth room contains the Cellar Warden; choose its keepsake, then return.

A safe return after room 4 attracts Toll, whose kit uses Hunger. A safe return after room 8 attracts Moss, whose pack and patch kit use Salvage. They cost 4 and 5 coin. Hires are permanent. Equipment remains with its member. At 4 experience choose one permanent trait: cycle-start healing or guard. Spend 3 coin to refine an eligible item's damage, healing or guard once.

Defeat or abandonment loses unbanked finds, scrap and experience. Recover the departure kit. The member gains an injury; a free night of rest clears it. Returning without selecting an offered item forfeits that offer. There is no passive inventory growth.

## Data boundaries

`plugins/bell/campaign.js` exports plain adventurer and trait records, plus functions for hire, embark, return, rest, learn and refine. Abilities use existing grid primitives. Journey combat keeps the existing immutable rule snapshots and feedback queue. Permanent item records contain instance id, type, position and optional refinement. Room transitions rebuild combat values from item definitions and apply refinements once.

`company` contains version, coins, roster, cleared, bestDepth, active and notice. Each roster member holds id, experience, trait, injuries, expeditions and kit. Active journey records its member and departure kit. Settlement requires the current active journey and happens once.

`company-save.js` confines localStorage access and validates loaded records. Key: `black-bell-company-v1`. Save only at stable decisions, never during a queued combat animation. Reload resumes the last stable decision; an interrupted fight may replay. Family Lab does not alter campaign progression. Corrupt saves are preserved with a visible warning; unavailable storage produces a session-only warning.

This is device/browser-local storage, not an account or cloud save. Clearing app data removes it. There is no migration from the earlier unsaved endless run. Simultaneous deployments, equipment trading, further trait tiers and campaign routes are deferred.

## Verification

`tests/campaign.test.mjs` covers real four-room and eight-room runs, unlocks, personal equipment, permanent improvements, defeat, duplicate settlement and persistence. Existing UI tests cover pack acquisition across expeditions. `agent-runs/black-bell-items/verify-tavern.mjs` exercises the exported player, landscape layout and reload. The standalone player must not toggle off a session already restored by engine reload recovery.
