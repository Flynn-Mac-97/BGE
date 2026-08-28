/**
 * What an entity is holding.
 *
 * A behaviour rather than something built into the player type, because a bot
 * and a human must carry weapons the same way. If a bot had its own inventory
 * there would be two sets of reload timings, two deploy delays and two answers
 * to "how fast does an AWP let you walk" — and the moment those disagree, the
 * human and the bot are playing different games and neither can be balanced.
 *
 * The bag is the contract everything else reads:
 *
 *   { primary, secondary, knife, grenades, bomb,
 *     current, ammo, reserve, nextShotAt, reloadingUntil, shotsFired }
 *
 * Anything that wants to know what an entity is holding reads
 * `entity.carriesWeapons.current`. That is a plain field read on the entity,
 * which is the only way two behaviours are allowed to agree in this engine.
 *
 * The verbs live in the Weapons plugin — give, fire, reload, select, drop — so
 * that the table and the trigger are in one file and the state is in this one.
 * What this file owns is the passage of time: finishing a reload, keeping the
 * movement factor honest, and letting the spray pattern go cold.
 */

/** Where in a reload each of the three sounds falls, as a fraction of its length. */
const RELOAD_STAGES = [0, 0.45, 0.85]
const RELOAD_SOUNDS = [
  'assets/counter-strike/sounds/reload-clipout.wav',
  'assets/counter-strike/sounds/reload-clipin.wav',
  'assets/counter-strike/sounds/reload-slide.wav'
]

export default {
  about: 'hold weapons, spend their ammunition, and reload them',

  /**
   * The four slots, named so a level can fit a player out in visible JSON:
   *
   *   "behaviours": { "carries-weapons": { "primary": "ak47", "secondary": "glock18" } }
   *
   * `current`, `ammo` and `reserve` are declared as well as kept, because they
   * double as the inspector's answer to "what is this bot holding right now",
   * which is the first question anybody asks of a bot that is losing.
   */
  properties: {
    primary: '',
    secondary: '',
    knife: 'knife',
    bomb: '',
    current: '',
    ammo: 0,
    reserve: 0
  },

  start(entity, context, self) {
    // The bag under the name the rest of the game was told to read. The engine
    // files a behaviour's bag under its file name, `entity['carries-weapons']`,
    // and eight other lanes were given `entity.carriesWeapons` — so both names
    // point at the one object rather than at two that can drift apart.
    entity.carriesWeapons = self

    if (!context.weapons) {
      console.error(`[carries-weapons] ${entity.id} has nothing to carry — the Weapons plugin did not load`)
      return
    }

    // The running state — magazines, timers, the spray — is filled in by the
    // Weapons plugin rather than here, because a buy menu can reach a freshly
    // spawned bot before its first step and would otherwise be handing rounds
    // to fields that do not exist yet. One initialiser, two ways in.
    context.weapons.prepare(entity)

    // Something has already fitted this one out — a buy, or a pick-up between
    // the spawn and the first step. Handing it the declared loadout now would
    // quietly take that away.
    if (self.current) return

    // Given worst first, so the best one ends up deployed — which is what
    // buying a rifle does in the original, and what a player expects on spawn.
    for (const id of [self.knife, self.bomb, self.secondary, self.primary]) {
      if (id) context.weapons.give(entity, id)
    }
  },

  update(entity, seconds, context, self) {
    const weapons = context.weapons
    if (!weapons) return
    // Idempotent, and cheap: a bag attached to a live entity after `start` has
    // been and gone would otherwise never get its running state at all.
    weapons.prepare(entity)
    const weapon = weapons.get(self.current)

    // Movement speed is a plain number on the bag because the movement code has
    // to read it every step and cannot look this behaviour up. An AWP walks at
    // 84% of a knife's pace, and that trade is the whole reason to hold an angle
    // with one instead of pushing with it.
    self.moveSpeedFactor = weapon ? weapon.moveSpeedFactor : 1

    if (self.reloadingUntil > 0 && weapon) finishReload(entity, context, self, weapon)

    // Let the spray go cold. Done here as well as in the trigger so that a HUD
    // drawing a crosshair from `shotsFired` opens back up while the player is
    // simply standing there, rather than only on the next shot. The interval is
    // the trigger's own, so the two can never disagree about when it is cold.
    if (self.shotsFired > 0 && context.time - self.lastShotAt > weapons.sprayResetSeconds) {
      self.shotsFired = 0
      self.recoilPitch = 0
      self.recoilYaw = 0
    }
  }
}

/**
 * Carry a magazine change forward one step.
 *
 * Driven from the clock rather than from timers, so an interrupted reload needs
 * nothing cancelled — a switch or a death clears `reloadingUntil` and the whole
 * thing is forgotten. A timer left running is how a player who switched to a
 * knife mid-reload finds their rifle full a second later.
 */
function finishReload(entity, context, self, weapon) {
  const length = Math.max(0.001, weapon.reloadSeconds)
  const through = (context.time - self.reloadStartedAt) / length

  // Clip out, clip in, slide: three sounds because a reload you can hear the
  // shape of is one an enemy can time, and being caught reloading is supposed
  // to be a punishable mistake.
  while (self.reloadStage < RELOAD_STAGES.length && through >= RELOAD_STAGES[self.reloadStage]) {
    context.play(RELOAD_SOUNDS[self.reloadStage])
    self.reloadStage += 1
  }

  if (context.time < self.reloadingUntil) return

  const wanted = weapon.magazine - self.ammo
  const taken = Math.min(wanted, self.reserve)
  self.ammo += taken
  self.reserve -= taken
  self.magazines[self.current] = self.ammo
  self.reserves[self.current] = self.reserve
  self.reloadingUntil = 0
  self.reloadStage = 0
  context.bus.emit('weapon:reloaded', { entity, weapon: weapon.id, ammo: self.ammo, reserve: self.reserve })
}
