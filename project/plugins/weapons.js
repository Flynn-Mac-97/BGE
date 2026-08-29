/**
 * Weapons — the table, the trigger, and the spray pattern.
 *
 * Counter-Strike is not a shooter with guns bolted on. The guns *are* the game:
 * every round is a decision about money, and every weapon is a different bargain
 * between damage, rate, armour penetration, accuracy and how fast it lets you
 * walk. Those relationships are the whole design, so the numbers below are the
 * real ones wherever they are known, and where they are not, the value chosen is
 * the one that keeps the relationship between weapons intact. Each such guess is
 * marked.
 *
 * What this plugin contributes:
 *
 *   context.weapons.table            every weapon, keyed by id
 *   context.weapons.get(id)
 *   context.weapons.give(entity, id) put one in a carrier's inventory
 *   context.weapons.fire(entity)     pull the trigger once
 *   context.weapons.reload(entity)
 *   context.weapons.select(entity, slot)
 *   context.weapons.drop(entity)
 *   context.weapons.damageTo(...)    the armour and hitbox arithmetic, one copy
 *
 * What it does NOT do: draw. A shot announces itself on the bus as
 * "weapon:fired" and an impact as "weapon:hit", carrying the ray and the point,
 * and whoever owns tracers, muzzle flashes and decals listens. That is a bus
 * event rather than a direct call for two reasons. The first is ownership: the
 * drawing lives in another plugin written by another hand, and a direct call
 * would make this file import it and fail without it. The second is that there
 * is more than one listener — a tracer, a flash, a decal, a bot's "I heard
 * that" and a spectator's kill feed all want the same shot, and a bus is the
 * only shape where adding the fifth listener does not edit this file.
 *
 * Sound is played here, not announced, because the weapon is the only thing that
 * knows which of the 48 files it is, and a shot that makes no noise is not a
 * shot. Volume is never passed: the mix between these files is already decided
 * and deliberate, and overriding it undoes the reason the AWP is frightening.
 *
 * The units are the engine's: metres, seconds, radians. Y is up, X and Z are the
 * ground plane, positive yaw turns left and positive pitch looks up — the
 * convention Game Camera writes down in full.
 */

/**
 * A name containing a slash resolves from project/, and a bare one from
 * project/assets/. Spelling the folder out here is what stops every shot in the
 * game from being a 404.
 */
const SOUND = 'assets/counter-strike/sounds/'

/** Variation families. Chosen with context.random.pick so a replay sounds the same. */
const FLESH = [SOUND + 'hit-flesh-1.wav', SOUND + 'hit-flesh-2.wav', SOUND + 'hit-flesh-3.wav']
const WALL = [SOUND + 'hit-wall-1.wav', SOUND + 'hit-wall-2.wav', SOUND + 'hit-wall-3.wav']
const RICOCHET = [SOUND + 'ricochet-1.wav', SOUND + 'ricochet-2.wav']

const DEPLOY_SOUND = SOUND + 'weapon-deploy.wav'
const PICKUP_SOUND = SOUND + 'pickup-weapon.wav'
const ARMOUR_SOUND = SOUND + 'armor-hit.wav'
const HELMET_SOUND = SOUND + 'hit-helmet.wav'

/**
 * Counter-Strike's own arithmetic, converted from Half-Life units.
 *
 * Damage falls off as rangeModifier raised to the distance in 500-unit steps,
 * and 500 units is 12.7 m. Armour keeps half of what it stops. Both numbers are
 * from the original and both are load-bearing: change ARMOUR_BONUS and a vest
 * stops lasting a whole round.
 */
const FALLOFF_STEP = 12.7
const ARMOUR_BONUS = 0.5

/** How long a bullet is allowed to travel. 8192 Half-Life units, the engine's own reach. */
const MAX_SHOT_DISTANCE = 208

/** The spray pattern returns to shot one after this long off the trigger. */
const SPRAY_RESET_SECONDS = 0.3

/**
 * Where a hit lands, as a fraction of the body's height from the feet, and what
 * each one multiplies the damage by.
 *
 * The head is four times a chest, which is the single fact the whole game is
 * balanced around: it is why an AK is worth 600 dollars more than a Galil and
 * why a helmet is worth buying against one and not the other.
 */
const HITBOX = {
  head: { from: 0.88, multiplier: 4, armoured: 'helmet' },
  chest: { from: 0.6, multiplier: 1, armoured: 'armour' },
  stomach: { from: 0.42, multiplier: 1.25, armoured: 'armour' },
  leg: { from: 0, multiplier: 0.75, armoured: null }
}
const HITBOXES = Object.entries(HITBOX).sort((a, b) => b[1].from - a[1].from)

/** Counter-Strike's standing and ducked eye heights, the same two the camera uses. */
const EYE_HEIGHT = 1.62
const CROUCH_EYE_HEIGHT = 0.91

/** The speed a player runs at with a knife out, which every moveSpeedFactor is measured against. */
const RUN_SPEED = 6.35

/**
 * How much wider the cone gets in each of the four states that are most of
 * Counter-Strike's tactics. Standing still is 1 by definition; everything else
 * is measured against it.
 *
 * Jumping is the harshest on purpose. A game where you can shoot accurately in
 * the air is a game of jumping duels, which is a different and much worse game.
 */
const CROUCH_ACCURACY = 0.35
const MOVING_ACCURACY = 4      // at a full run, on top of the standing cone
const AIRBORNE_ACCURACY = 8

/**
 * The width of a chest at the range a weapon is called accurate to. Turning
 * accurateRange into a cone this way is what stops that field from being
 * decoration — a weapon accurate to 40 m really does group inside a torso there.
 */
const ACCURATE_SPREAD = 0.17

const DEGREES = Math.PI / 180

// ------------------------------------------------------------- the spray path
/**
 * The pattern, as an array of cumulative (pitch, yaw) offsets indexed by shot.
 *
 * This is the famous thing. An automatic weapon in Counter-Strike walks its
 * shots along a fixed, learnable path — up first, then a hard sweep left, then
 * back right — and learning that path is the skill ceiling of the game. The
 * entry at index n is where the aim IS on the n-th shot of a burst, not how far
 * that shot kicked, because a player learns a shape rather than a series of
 * nudges.
 *
 * Generated from three numbers per weapon rather than typed out as six hundred
 * literals. The array is still a per-shot lookup and still exact; what the
 * generator buys is that the AK and the M4 differ by two numbers you can compare
 * at a glance instead of by thirty pairs nobody will ever diff.
 *
 *   climb       total rise, in degrees, by the time the pattern flattens
 *   climbShots  how many shots that rise is spent over — the AK's nine
 *   sway        how far the sweep goes to each side once the climb is done
 */
function sprayPattern({ magazine, recoil }) {
  if (!recoil || !magazine) return [{ pitch: 0, yaw: 0 }]
  const { climb, climbShots, sway } = recoil
  const shots = Math.max(magazine, climbShots + 1)
  const pattern = []

  for (let n = 0; n < shots; n++) {
    // Ease-out: most of the rise is spent in the first few shots, which is why
    // tapping is accurate and the tenth shot of a spray is not.
    const rise = Math.min(1, (n + 1) / climbShots)
    const pitch = climb * (1 - (1 - rise) * (1 - rise))

    // Nothing sideways while it climbs, beyond a small deliberate wobble, then
    // one full sweep: left to the limit, back through the middle, right to the
    // limit, and home. sin over the remaining shots is that shape exactly.
    const after = Math.max(0, n + 1 - climbShots) / Math.max(1, shots - climbShots)
    const wobble = climb * 0.02 * Math.sin(n * 1.9)
    pattern.push({ pitch, yaw: sway * Math.sin(after * Math.PI * 2) + wobble })
  }
  return pattern
}

// -------------------------------------------------------------- the weapons
/**
 * One weapon, with everything a weapon needs and nothing it does not.
 *
 * `kind` is derived from the slot rather than declared, because a thing in the
 * knife slot is a knife and there is no case where those two disagree.
 */
function weapon(declared) {
  const slot = declared.slot
  return {
    pellets: 1,
    automatic: false,
    wallPenetration: 0,
    team: null,
    ...declared,
    kind: slot === 'knife' ? 'melee' : slot === 'grenade' ? 'throwable' : slot === 'bomb' ? 'bomb' : 'hitscan',
    pattern: sprayPattern(declared)
  }
}

/**
 * Every weapon in the game.
 *
 * `damage` is per bullet before any multiplier. `armourPenetration` is the
 * fraction of damage that gets through a vest — the AK's 0.775 against the M4's
 * 0.7 is the difference between a helmet being worth 350 dollars and not.
 * `rangeModifier` is the per-12.7-metre falloff. `moveSpeedFactor` is the
 * fraction of a knife-carrier's run speed, and the reason an AWPer holds an
 * angle instead of taking one.
 *
 * Prices, magazines, reserves and kill rewards are Counter-Strike 1.6's own.
 * Reload and deploy times are measured from the original's animations and are
 * accurate to about a tenth of a second, which is the honest precision. Accurate
 * ranges are a judgement — the original expresses the same idea as a spread
 * constant — chosen to preserve the ordering: pistols short, rifles long,
 * snipers longest.
 */
const WEAPONS = [
  weapon({
    id: 'knife', name: 'Knife', slot: 'knife', price: 0,
    damage: 20, armourPenetration: 0.85, roundsPerMinute: 150,
    magazine: 0, reserve: 0, reloadSeconds: 0, deploySeconds: 0.4,
    killReward: 1500, accurateRange: 1.5, moveSpeedFactor: 1,
    rangeModifier: 1, recoil: null, sound: SOUND + 'knife-slash.wav',
    // A knife reaches about a metre and a half, which is why closing that last
    // metre against a rifle is the bravest thing in the game.
    reach: 1.5
  }),

  // ----------------------------------------------------------------- pistols
  weapon({
    id: 'glock18', name: 'Glock 18', slot: 'secondary', price: 400,
    damage: 25, armourPenetration: 0.5, roundsPerMinute: 400,
    magazine: 20, reserve: 120, reloadSeconds: 2.2, deploySeconds: 0.5,
    killReward: 300, accurateRange: 22, moveSpeedFactor: 1,
    rangeModifier: 0.75, recoil: { climb: 4.5, climbShots: 6, sway: 2 },
    sound: SOUND + 'glock-fire.wav', wallPenetration: 0.1, team: 'terrorist'
  }),
  weapon({
    id: 'usp', name: 'USP Tactical', slot: 'secondary', price: 500,
    damage: 34, armourPenetration: 0.5, roundsPerMinute: 352,
    magazine: 12, reserve: 100, reloadSeconds: 2.7, deploySeconds: 0.5,
    killReward: 300, accurateRange: 25, moveSpeedFactor: 1,
    rangeModifier: 0.79, recoil: { climb: 4, climbShots: 5, sway: 1.6 },
    sound: SOUND + 'usp-fire.wav', silencedSound: SOUND + 'usp-silenced.wav',
    wallPenetration: 0.1, team: 'counter-terrorist'
  }),
  weapon({
    id: 'p228', name: 'P228 Compact', slot: 'secondary', price: 600,
    damage: 32, armourPenetration: 0.6, roundsPerMinute: 400,
    magazine: 13, reserve: 52, reloadSeconds: 2.7, deploySeconds: 0.5,
    killReward: 300, accurateRange: 20, moveSpeedFactor: 1,
    rangeModifier: 0.8, recoil: { climb: 4.4, climbShots: 5, sway: 1.8 },
    // There is no P228 report in the sound set. The USP is the same calibre
    // class and the closest thing in it; a dedicated file would be better.
    sound: SOUND + 'usp-fire.wav', wallPenetration: 0.12
  }),
  weapon({
    id: 'fiveseven', name: 'Five-SeveN', slot: 'secondary', price: 750,
    damage: 25, armourPenetration: 0.885, roundsPerMinute: 400,
    magazine: 20, reserve: 100, reloadSeconds: 2.7, deploySeconds: 0.5,
    killReward: 300, accurateRange: 22, moveSpeedFactor: 1,
    rangeModifier: 0.885, recoil: { climb: 4.2, climbShots: 5, sway: 1.7 },
    sound: SOUND + 'usp-fire.wav', wallPenetration: 0.14, team: 'counter-terrorist'
  }),
  weapon({
    id: 'elites', name: 'Dual Berettas', slot: 'secondary', price: 800,
    damage: 20, armourPenetration: 0.5, roundsPerMinute: 500,
    magazine: 30, reserve: 120, reloadSeconds: 4.5, deploySeconds: 0.7,
    killReward: 300, accurateRange: 18, moveSpeedFactor: 1,
    rangeModifier: 0.75, recoil: { climb: 5, climbShots: 8, sway: 2.6 },
    sound: SOUND + 'glock-fire.wav', wallPenetration: 0.1, team: 'terrorist'
  }),
  weapon({
    id: 'deagle', name: 'Desert Eagle', slot: 'secondary', price: 650,
    damage: 54, armourPenetration: 0.905, roundsPerMinute: 267,
    magazine: 7, reserve: 35, reloadSeconds: 2.2, deploySeconds: 0.6,
    killReward: 300, accurateRange: 30, moveSpeedFactor: 1,
    rangeModifier: 0.81, recoil: { climb: 8.5, climbShots: 4, sway: 2.4 },
    sound: SOUND + 'deagle-fire.wav', wallPenetration: 0.25
  }),

  // ---------------------------------------------------------------- shotguns
  weapon({
    id: 'm3', name: 'M3 Super 90', slot: 'primary', price: 1700,
    // Nine pellets of 26. A whole cartridge on target at contact range is 234,
    // and one pellet at twenty metres is nothing — that spread IS the weapon.
    damage: 26, pellets: 9, pelletSpread: 4,
    armourPenetration: 0.5, roundsPerMinute: 75,
    magazine: 8, reserve: 32, reloadSeconds: 3.5, deploySeconds: 0.6,
    killReward: 900, accurateRange: 8, moveSpeedFactor: 0.92,
    rangeModifier: 0.7, recoil: { climb: 9, climbShots: 4, sway: 2 },
    // No shotgun report exists in the sound set. The Desert Eagle is the
    // nearest thing to a boom in it; the AWP would be far too loud for a weapon
    // fired twice a second.
    sound: SOUND + 'deagle-fire.wav'
  }),
  weapon({
    id: 'xm1014', name: 'XM1014', slot: 'primary', price: 3000,
    damage: 20, pellets: 6, pelletSpread: 4.5,
    armourPenetration: 0.5, roundsPerMinute: 240,
    magazine: 7, reserve: 32, reloadSeconds: 3, deploySeconds: 0.6,
    killReward: 900, accurateRange: 10, moveSpeedFactor: 0.96,
    rangeModifier: 0.7, recoil: { climb: 7.5, climbShots: 5, sway: 2.4 },
    automatic: true, sound: SOUND + 'deagle-fire.wav'
  }),

  // -------------------------------------------------------------------- SMGs
  weapon({
    id: 'tmp', name: 'Steyr TMP', slot: 'primary', price: 1250,
    damage: 26, armourPenetration: 0.5, roundsPerMinute: 857,
    magazine: 30, reserve: 120, reloadSeconds: 2.1, deploySeconds: 0.5,
    killReward: 600, accurateRange: 20, moveSpeedFactor: 1,
    rangeModifier: 0.85, recoil: { climb: 5.6, climbShots: 10, sway: 2.8 },
    automatic: true, sound: SOUND + 'mp5-fire.wav',
    wallPenetration: 0.1, team: 'counter-terrorist'
  }),
  weapon({
    id: 'mac10', name: 'MAC-10', slot: 'primary', price: 1400,
    damage: 29, armourPenetration: 0.5, roundsPerMinute: 800,
    magazine: 30, reserve: 100, reloadSeconds: 2.6, deploySeconds: 0.5,
    killReward: 600, accurateRange: 20, moveSpeedFactor: 1,
    rangeModifier: 0.82, recoil: { climb: 8, climbShots: 9, sway: 4.6 },
    automatic: true, sound: SOUND + 'mp5-fire.wav',
    wallPenetration: 0.1, team: 'terrorist'
  }),
  weapon({
    id: 'mp5navy', name: 'MP5 Navy', slot: 'primary', price: 1500,
    damage: 26, armourPenetration: 0.5, roundsPerMinute: 750,
    magazine: 30, reserve: 120, reloadSeconds: 2.6, deploySeconds: 0.5,
    killReward: 600, accurateRange: 25, moveSpeedFactor: 1,
    rangeModifier: 0.84, recoil: { climb: 6.2, climbShots: 10, sway: 3 },
    automatic: true, sound: SOUND + 'mp5-fire.wav', wallPenetration: 0.12
  }),
  weapon({
    id: 'ump45', name: 'UMP45', slot: 'primary', price: 1700,
    damage: 30, armourPenetration: 0.55, roundsPerMinute: 667,
    magazine: 25, reserve: 100, reloadSeconds: 3.5, deploySeconds: 0.5,
    killReward: 600, accurateRange: 22, moveSpeedFactor: 1,
    rangeModifier: 0.82, recoil: { climb: 6.6, climbShots: 9, sway: 3.2 },
    automatic: true, sound: SOUND + 'mp5-fire.wav', wallPenetration: 0.14
  }),
  weapon({
    id: 'p90', name: 'FN P90', slot: 'primary', price: 2350,
    // The P90's armour penetration is a rifle's on a submachine gun's body, and
    // its kill reward is a rifle's too — 300, not the 600 the other SMGs pay.
    // Both of those are why it is bought, and both are easy to round off.
    damage: 26, armourPenetration: 0.885, roundsPerMinute: 857,
    magazine: 50, reserve: 100, reloadSeconds: 3.4, deploySeconds: 0.5,
    killReward: 300, accurateRange: 20, moveSpeedFactor: 0.98,
    rangeModifier: 0.885, recoil: { climb: 6, climbShots: 12, sway: 3.4 },
    automatic: true, sound: SOUND + 'mp5-fire.wav', wallPenetration: 0.2
  }),

  // ------------------------------------------------------------------ rifles
  weapon({
    id: 'galil', name: 'IMI Galil', slot: 'primary', price: 2000,
    damage: 30, armourPenetration: 0.775, roundsPerMinute: 667,
    magazine: 35, reserve: 90, reloadSeconds: 3, deploySeconds: 0.6,
    killReward: 300, accurateRange: 35, moveSpeedFactor: 0.96,
    rangeModifier: 0.98, recoil: { climb: 11.5, climbShots: 9, sway: 6 },
    automatic: true, sound: SOUND + 'ak47-fire.wav',
    wallPenetration: 0.3, team: 'terrorist'
  }),
  weapon({
    id: 'famas', name: 'FAMAS', slot: 'primary', price: 2250,
    damage: 30, armourPenetration: 0.7, roundsPerMinute: 667,
    magazine: 25, reserve: 90, reloadSeconds: 3.3, deploySeconds: 0.6,
    killReward: 300, accurateRange: 35, moveSpeedFactor: 0.96,
    rangeModifier: 0.96, recoil: { climb: 9, climbShots: 9, sway: 4.2 },
    automatic: true, sound: SOUND + 'm4a1-fire.wav',
    wallPenetration: 0.28, team: 'counter-terrorist'
  }),
  weapon({
    id: 'ak47', name: 'AK-47', slot: 'primary', price: 2500,
    // 36 damage times the head's four is 144, and 144 through a helmet's 0.775
    // is 111.6 — over a hundred, so an AK takes a helmeted head off in one. The
    // M4 below cannot, and that single sum is why the two guns cost what they do.
    damage: 36, armourPenetration: 0.775, roundsPerMinute: 600,
    magazine: 30, reserve: 90, reloadSeconds: 2.5, deploySeconds: 0.6,
    killReward: 300, accurateRange: 40, moveSpeedFactor: 0.884,
    rangeModifier: 0.98,
    // Nine shots almost straight up, then a hard sweep left and back across to
    // the right. This is the pattern people can draw from memory.
    recoil: { climb: 12.9, climbShots: 9, sway: 6.5 },
    automatic: true, sound: SOUND + 'ak47-fire.wav',
    wallPenetration: 0.35, team: 'terrorist'
  }),
  weapon({
    id: 'm4a1', name: 'M4A1 Carbine', slot: 'primary', price: 3100,
    damage: 33, armourPenetration: 0.7, roundsPerMinute: 666,
    magazine: 30, reserve: 90, reloadSeconds: 3.1, deploySeconds: 0.6,
    killReward: 300, accurateRange: 40, moveSpeedFactor: 0.92,
    rangeModifier: 0.97, recoil: { climb: 9.5, climbShots: 10, sway: 4.6 },
    automatic: true, sound: SOUND + 'm4a1-fire.wav',
    silencedSound: SOUND + 'm4a1-silenced.wav',
    wallPenetration: 0.32, team: 'counter-terrorist'
  }),
  weapon({
    id: 'aug', name: 'Steyr AUG', slot: 'primary', price: 3500,
    damage: 32, armourPenetration: 0.7, roundsPerMinute: 666,
    magazine: 30, reserve: 90, reloadSeconds: 3.3, deploySeconds: 0.6,
    killReward: 300, accurateRange: 45, moveSpeedFactor: 0.884,
    rangeModifier: 0.96, recoil: { climb: 8.6, climbShots: 10, sway: 3.8 },
    automatic: true, zoom: true, sound: SOUND + 'm4a1-fire.wav',
    wallPenetration: 0.32, team: 'counter-terrorist'
  }),
  weapon({
    id: 'sg552', name: 'SIG SG 552', slot: 'primary', price: 3500,
    damage: 33, armourPenetration: 0.7, roundsPerMinute: 600,
    magazine: 30, reserve: 90, reloadSeconds: 3, deploySeconds: 0.6,
    killReward: 300, accurateRange: 45, moveSpeedFactor: 0.94,
    rangeModifier: 0.955, recoil: { climb: 10.5, climbShots: 9, sway: 5.2 },
    automatic: true, zoom: true, sound: SOUND + 'ak47-fire.wav',
    wallPenetration: 0.32, team: 'terrorist'
  }),

  // ----------------------------------------------------------------- snipers
  weapon({
    id: 'scout', name: 'Steyr Scout', slot: 'primary', price: 2750,
    damage: 75, armourPenetration: 0.85, roundsPerMinute: 48,
    magazine: 10, reserve: 90, reloadSeconds: 2, deploySeconds: 0.6,
    killReward: 300, accurateRange: 60,
    // The Scout is the only weapon in the game that is faster than a knife.
    moveSpeedFactor: 1.04,
    rangeModifier: 0.98, recoil: { climb: 5, climbShots: 3, sway: 1 },
    zoom: true, sound: SOUND + 'awp-fire.wav', wallPenetration: 0.4
  }),
  weapon({
    id: 'awp', name: 'AWP', slot: 'primary', price: 4750,
    // 115 at the chest, so one shot kills anywhere above the legs, through a
    // vest, at any range worth taking. The kill reward is 100 rather than 300:
    // the game takes the money back off you for owning the round that easily.
    damage: 115, armourPenetration: 0.975, roundsPerMinute: 41,
    magazine: 10, reserve: 30, reloadSeconds: 3.7, deploySeconds: 1,
    killReward: 100, accurateRange: 80, moveSpeedFactor: 0.84,
    rangeModifier: 0.99, recoil: { climb: 8, climbShots: 3, sway: 1.2 },
    zoom: true, sound: SOUND + 'awp-fire.wav', wallPenetration: 0.6
  }),
  weapon({
    id: 'g3sg1', name: 'H&K G3/SG-1', slot: 'primary', price: 5000,
    damage: 80, armourPenetration: 0.8, roundsPerMinute: 240,
    magazine: 20, reserve: 90, reloadSeconds: 4.6, deploySeconds: 0.8,
    killReward: 300, accurateRange: 60, moveSpeedFactor: 0.84,
    rangeModifier: 0.98, recoil: { climb: 7, climbShots: 6, sway: 3 },
    zoom: true, automatic: true,
    // Both auto-snipers borrow the AWP's report: it is the only heavy rifle
    // crack in the set, and these are the same class of rifle.
    sound: SOUND + 'awp-fire.wav', wallPenetration: 0.5, team: 'terrorist'
  }),
  weapon({
    id: 'sg550', name: 'SIG SG 550', slot: 'primary', price: 4200,
    damage: 70, armourPenetration: 0.7, roundsPerMinute: 240,
    magazine: 30, reserve: 90, reloadSeconds: 3.8, deploySeconds: 0.8,
    killReward: 300, accurateRange: 60, moveSpeedFactor: 0.84,
    rangeModifier: 0.98, recoil: { climb: 6, climbShots: 6, sway: 2.6 },
    zoom: true, automatic: true,
    sound: SOUND + 'awp-fire.wav', wallPenetration: 0.5, team: 'counter-terrorist'
  }),

  // --------------------------------------------------------- machine gun
  weapon({
    id: 'm249', name: 'FN M249 Para', slot: 'primary', price: 5750,
    damage: 32, armourPenetration: 0.8, roundsPerMinute: 750,
    magazine: 100, reserve: 200, reloadSeconds: 5.7, deploySeconds: 1,
    killReward: 300, accurateRange: 35, moveSpeedFactor: 0.88,
    rangeModifier: 0.97, recoil: { climb: 13.5, climbShots: 12, sway: 8 },
    // No belt-fed report in the sound set; the AK is the nearest rifle crack.
    automatic: true, sound: SOUND + 'ak47-fire.wav', wallPenetration: 0.45
  }),

  // -------------------------------------------------------------- grenades
  weapon({
    id: 'hegrenade', name: 'HE Grenade', slot: 'grenade', price: 300,
    // Damage at the centre of the blast; whoever owns the explosion falls it
    // off over the radius. Carried one at a time.
    damage: 98, blastRadius: 4.4, armourPenetration: 0.5,
    roundsPerMinute: 60, magazine: 1, maximum: 1, reserve: 0,
    reloadSeconds: 0, deploySeconds: 0.5, killReward: 300,
    accurateRange: 20, moveSpeedFactor: 1, rangeModifier: 1, recoil: null,
    sound: SOUND + 'radio-fireinthehole.wav', explodeSound: SOUND + 'bomb-explode.wav'
  }),
  weapon({
    id: 'flashbang', name: 'Flashbang', slot: 'grenade', price: 200,
    damage: 0, blastRadius: 7, armourPenetration: 0,
    roundsPerMinute: 60, magazine: 1, maximum: 2, reserve: 0,
    reloadSeconds: 0, deploySeconds: 0.5, killReward: 0,
    accurateRange: 20, moveSpeedFactor: 1, rangeModifier: 1, recoil: null,
    sound: SOUND + 'radio-fireinthehole.wav', explodeSound: SOUND + 'bomb-explode.wav'
  }),
  weapon({
    id: 'smokegrenade', name: 'Smoke Grenade', slot: 'grenade', price: 300,
    damage: 0, blastRadius: 4, armourPenetration: 0,
    roundsPerMinute: 60, magazine: 1, maximum: 1, reserve: 0,
    reloadSeconds: 0, deploySeconds: 0.5, killReward: 0,
    accurateRange: 20, moveSpeedFactor: 1, rangeModifier: 1, recoil: null,
    sound: SOUND + 'radio-fireinthehole.wav'
  }),

  // ------------------------------------------------------------------ bomb
  weapon({
    id: 'c4', name: 'C4 Explosive', slot: 'bomb', price: 0,
    damage: 500, blastRadius: 12, armourPenetration: 1,
    roundsPerMinute: 0, magazine: 0, reserve: 0,
    reloadSeconds: 0, deploySeconds: 1, killReward: 0,
    accurateRange: 0, moveSpeedFactor: 1, rangeModifier: 1, recoil: null,
    // Planting, defusing and the beep belong to the match rules; the bomb is in
    // this table because it occupies a slot and slows nobody down.
    sound: SOUND + 'c4-plantstart.wav', team: 'terrorist'
  })
]

/** Keyed by id, which is how everything else in the game names a weapon. */
export const table = Object.fromEntries(WEAPONS.map(w => [w.id, w]))

/** Which weapon each numbered slot holds, in Counter-Strike's own order. */
const SLOTS = ['primary', 'secondary', 'knife', 'grenade', 'bomb']

// ------------------------------------------------------------ the arithmetic
/**
 * What a distance does to a bullet: Counter-Strike's own falloff, converted.
 *
 * The original raises the weapon's range modifier to the distance in 500-unit
 * steps, and 500 units is 12.7 m. A Glock keeps a quarter of its damage every
 * thirteen metres; an AWP keeps ninety-nine per cent of its.
 */
export const falloff = (weaponData, distance) =>
  Math.pow(weaponData.rangeModifier ?? 1, Math.max(0, distance) / FALLOFF_STEP)

/**
 * Damage through armour, and what the armour lost stopping it.
 *
 * This is Half-Life's formula with Counter-Strike's constants, and it lives in
 * the weapons file because the number that drives it — the weapon's armour
 * penetration — is a property of the weapon. It is put on `context.weapons` so
 * that whoever owns `damageable` can call it rather than write a second copy: a
 * second copy would drift, and the first symptom would be an AK that stopped
 * one-shotting a helmet, which is the game's most recognisable fact.
 *
 * A vest covers the chest, the stomach and the arms. Only a helmet covers the
 * head, and nothing covers the legs — which is why a leg shot ignores armour
 * entirely and why an armoured player is still killed by enough of them.
 */
export function damageTo(weaponData, { hitbox = 'chest', distance = 0, armour = 0, helmet = false } = {}) {
  const box = HITBOX[hitbox] || HITBOX.chest
  let damage = weaponData.damage * box.multiplier * falloff(weaponData, distance)

  if (box.armoured === 'helmet') {
    // A helmet is not a pool the way a vest is: it takes the weapon's armour
    // ratio off the shot and that is all it ever does, which is why it keeps
    // working after the kevlar under it has been shot away. 36 x 4 x 0.775 is
    // 111.6 and 33 x 4 x 0.7 is 92.4 — the AK kills through it and the M4 does
    // not, and that single sum is the most recognisable fact in the game.
    return helmet ? { health: damage * weaponData.armourPenetration, armour: 0 } : { health: damage, armour: 0 }
  }
  if (box.armoured !== 'armour' || armour <= 0) return { health: damage, armour: 0 }

  const through = damage * weaponData.armourPenetration
  let stopped = (damage - through) * ARMOUR_BONUS
  if (stopped > armour) {
    // The vest is used up part-way through, so it only stops what it had left
    // and the rest arrives. Getting this branch wrong is how armour quietly
    // becomes either free or useless.
    stopped = armour
    damage = damage - stopped / ARMOUR_BONUS
  } else {
    damage = through
  }
  return { health: Math.max(0, damage), armour: stopped }
}

/**
 * Which hitbox a point on a body is, from how high up it landed.
 *
 * Measured as a fraction of the body's own height rather than in metres, so a
 * crouched player's head is still their head.
 */
export function hitboxAt(target, pointY) {
  const height = colliderHeight(target)
  if (!(height > 0)) return 'chest'
  const feet = target.y - height / 2
  const fraction = (pointY - feet) / height
  for (const [name, box] of HITBOXES) if (fraction >= box.from) return name
  return 'leg'
}

// -------------------------------------------------------------- the plugin
/**
 * The running weapons and the context they were handed.
 *
 * A test file is given `test` and nothing else, so there is otherwise no way for
 * one to fire a shot or read the aim it went along. A plugin module is a
 * singleton in node and in the browser alike, so importing this file from
 * project/tests reaches the very object the live world uses — the same
 * arrangement Game Camera uses for exactly the same reason.
 */
let running = null
export const runningWeapons = () => running

const alreadySaid = new Set()
function report(key, message) {
  if (alreadySaid.has(key)) return
  alreadySaid.add(key)
  console.error(`[weapons] ${message}`)
}

export default {
  name: 'Weapons',

  onLoad(context) {
    if (context.weapons) {
      console.error('[weapons] something else already put a weapons table on context — replacing it')
    }

    /**
     * The bag `carries-weapons` keeps, ready to be used.
     *
     * Two things happen here that look like housekeeping and are not.
     *
     * The engine files a behaviour's bag under its file name, so it arrives as
     * `entity['carries-weapons']`, while the rest of the game was told to read
     * `entity.carriesWeapons`. Both names are pointed at the one object rather
     * than at two that could drift.
     *
     * And the running state is filled in here rather than only in the
     * behaviour's `start`, because a bag exists from the moment the behaviour is
     * attached and `start` does not run until the next step. A buy menu that
     * fits a freshly spawned bot out before that step is a real case, and
     * "your gun arrives a frame late" is a horrible bug to find.
     */
    function prepare(entity) {
      const bag = entity?.carriesWeapons || entity?.['carries-weapons']
      if (!bag) return null
      entity.carriesWeapons = bag
      if (bag.magazines) return bag

      // What each weapon has left in it, kept per weapon rather than per player:
      // putting a rifle away and taking it out again must neither hand out a
      // fresh magazine nor lose the rounds that were in it.
      bag.magazines = {}
      bag.reserves = {}
      if (!Array.isArray(bag.grenades)) bag.grenades = []
      bag.current = bag.current || ''
      bag.ammo = bag.ammo ?? 0
      bag.reserve = bag.reserve ?? 0
      bag.nextShotAt = 0
      bag.reloadingUntil = 0
      bag.reloadStartedAt = 0
      bag.reloadStage = 0
      bag.shotsFired = 0
      bag.lastShotAt = -SPRAY_RESET_SECONDS
      bag.recoilPitch = 0
      bag.recoilYaw = 0
      bag.moveSpeedFactor = 1
      return bag
    }

    /** The same, but a carrier that is not one says so by name rather than silently doing nothing. */
    function inventoryOf(entity, verb) {
      const bag = prepare(entity)
      if (!bag) {
        report(`no-inventory-${entity?.id}`,
          `${entity?.id ?? 'something with no id'} cannot ${verb} — it has no "carries-weapons" behaviour`)
        return null
      }
      return bag
    }

    /**
     * Where the eye is. Derived from the body rather than read off the camera,
     * so a bot and a human fire from the same place and neither is helped by a
     * view bob that is only there to look right.
     */
    function eyeOf(entity) {
      const height = colliderHeight(entity)
      const feet = height > 0 ? entity.y - height / 2 : entity.y
      const eye = crouching(entity) ? CROUCH_EYE_HEIGHT : EYE_HEIGHT
      return { x: entity.x, y: feet + Math.min(eye, height > 0 ? height : eye), z: entity.z }
    }

    /**
     * Where this entity is pointing, and whether it is the one behind the eye.
     *
     * The local player aims with the camera, so the shot has to come off
     * `camera.aim()` — recoil included — or the crosshair and the bullet
     * disagree and spray control stops meaning anything. Anything the camera is
     * not following carries the same two numbers as plain fields, which is how a
     * bot aims: the same maths, no private path.
     */
    function aimOf(entity, bag) {
      const camera = context.camera
      if (camera && camera.target === entity && typeof camera.aim === 'function') {
        return { ...camera.aim(), throughTheEye: true }
      }
      return {
        yaw: (entity.aimYaw ?? 0) + bag.recoilYaw * DEGREES,
        pitch: (entity.aimPitch ?? 0) + bag.recoilPitch * DEGREES,
        throughTheEye: false
      }
    }

    /**
     * Put the aim where the spray pattern says it should be for this shot.
     *
     * The pattern is a position, not a nudge, so what is punched is the
     * difference between where the pattern wants the aim and where the recoil
     * already has it. The camera's own recovery is much faster than Counter-
     * Strike's, so kicking by the per-shot delta instead would let the aim
     * settle a couple of degrees up and stay there — a spray that never walks,
     * which is the same as no pattern at all.
     */
    function applyRecoil(entity, bag, weaponData) {
      const pattern = weaponData.pattern
      if (!pattern || pattern.length < 2) return

      const step = pattern[Math.min(bag.shotsFired - 1, pattern.length - 1)]
      // Learnable, but not identical: a small deterministic jitter from the
      // engine's own stream, so two sprays differ without the shape being lost.
      const jitter = (weaponData.recoil?.climb ?? 0) * 0.02
      bag.recoilPitch = step.pitch + context.random.range(-jitter, jitter)
      bag.recoilYaw = step.yaw + context.random.range(-jitter, jitter)

      const camera = context.camera
      if (!camera || camera.target !== entity || typeof camera.punch !== 'function') return
      camera.punch(
        bag.recoilPitch * DEGREES - (camera.punchPitch ?? 0),
        bag.recoilYaw * DEGREES - (camera.punchYaw ?? 0)
      )
    }

    /**
     * How wide the cone is right now, in radians.
     *
     * Standing still is the weapon's own accuracy; crouching is better; moving
     * is worse in proportion to how fast, and being in the air is worse than
     * anything. Those four states are most of Counter-Strike's tactics, and a
     * game that models only one of them plays like a deathmatch.
     */
    function coneOf(entity, weaponData) {
      const base = Math.atan(ACCURATE_SPREAD / Math.max(1, weaponData.accurateRange || 1))
      const speed = Math.hypot(entity.velocityX ?? 0, entity.velocityZ ?? 0)

      if (entity.grounded === false) return base * AIRBORNE_ACCURACY
      let factor = crouching(entity) ? CROUCH_ACCURACY : 1
      factor += (speed / RUN_SPEED) * MOVING_ACCURACY
      return base * factor
    }

    /** A direction, turned by a random amount inside a cone. Deterministic, from context.random. */
    function scatter(yaw, pitch, cone) {
      if (!(cone > 0)) return direction(yaw, pitch)
      // A uniform disc: the square root is what stops every shot clustering in
      // the middle of the cone, which reads as a weapon that is more accurate
      // than its number says.
      const radius = cone * Math.sqrt(context.random())
      const around = context.random.range(0, Math.PI * 2)
      return direction(yaw + Math.cos(around) * radius, pitch + Math.sin(around) * radius)
    }

    /**
     * One bullet, from the eye, along a direction. Returns what it hit, if
     * anything, after at most one continuation through a thin wall.
     */
    function bullet(entity, weaponData, origin, along, baseDamage) {
      if (typeof context.raycast !== 'function') {
        report('no-raycast', 'nothing has contributed context.raycast — every shot misses')
        return null
      }
      const reach = weaponData.kind === 'melee' ? (weaponData.reach ?? 1.5) : MAX_SHOT_DISTANCE
      const first = context.raycast(origin, along, reach, { ignore: [entity] })
      if (!first) return null

      if (damageableEntity(first.entity)) return land(entity, weaponData, first, along, baseDamage, false)

      // A wall. Wallbanging is a real Counter-Strike mechanic and de_dust2 has
      // famous spots for it, so a thin enough solid is shot through rather than
      // stopped at — once, not recursively, because a bullet that keeps finding
      // new walls is a frame budget problem in a map made of four hundred boxes.
      const through = penetrate(entity, weaponData, first, along, reach, baseDamage)
      if (through) return through
      return land(entity, weaponData, first, along, baseDamage, false)
    }

    /**
     * Try to carry the shot through one solid.
     *
     * The thickness is measured rather than guessed: a probe is placed at the
     * far side of what this weapon could penetrate and a ray is fired back at
     * the shooter against that one entity. A ray that starts inside a box
     * reports no hit, so a probe still inside the wall answers "too thick" by
     * itself — the same rule doing two jobs.
     */
    function penetrate(entity, weaponData, first, along, reach, baseDamage) {
      const limit = weaponData.wallPenetration ?? 0
      if (!(limit > 0) || first.entity.properties?.body !== 'solid') return null

      const span = limit + 0.02
      const probe = {
        x: first.point.x + along.x * span,
        y: first.point.y + along.y * span,
        z: first.point.z + along.z * span
      }
      const back = context.raycast(probe, { x: -along.x, y: -along.y, z: -along.z }, span,
        { hit: candidate => candidate === first.entity })
      if (!back) return null

      const thickness = span - back.distance
      // Thin cover barely costs the bullet anything; cover right at the weapon's
      // limit takes most of it. Both ends matter: the first is why a door is no
      // cover at all and the second is why a wall usually is.
      const kept = 0.35 + 0.4 * (1 - thickness / limit)
      context.bus.emit('weapon:penetrated', {
        entity, weapon: weaponData.id, point: first.point, through: first.entity, thickness
      })

      const beyond = context.raycast(probe, along, reach - first.distance - span,
        { ignore: [entity, first.entity] })
      if (!beyond) return null
      beyond.distance += first.distance + span
      return land(entity, weaponData, beyond, along, baseDamage * kept, true)
    }

    /** What a bullet does where it stops: damage if it is a person, a noise and a decal either way. */
    function land(entity, weaponData, hit, along, baseDamage, penetrated) {
      const target = hit.entity
      const person = damageableEntity(target)
      const hitbox = person ? hitboxAt(target, hit.point.y) : null
      const amount = baseDamage * falloff(weaponData, hit.distance)

      if (person && typeof context.damage === 'function') {
        // The hitbox and the weapon go with the number so that whoever owns
        // `damageable` can apply the multiplier and the armour itself — it is
        // the only thing that knows what the target is wearing.
        context.damage(target, {
          amount, from: entity, weapon: weaponData.id, hitbox, direction: along
        })
      } else if (person) {
        report('no-damage', 'nothing has contributed context.damage — shots hit people and do nothing')
      }

      if (person) {
        const armoured = target.damageable?.armour > 0
        const helmeted = hitbox === 'head' && target.damageable?.helmet
        context.play(helmeted ? HELMET_SOUND : armoured ? ARMOUR_SOUND : context.random.pick(FLESH))
      } else if (weaponData.kind === 'melee') {
        context.play(SOUND + 'knife-hit.wav')
      } else {
        // A grazing angle whines off rather than thuds in. Both families exist
        // in the sound set precisely so a firefight has two textures in it.
        const grazing = Math.abs(dot(along, hit.normal)) < 0.35
        context.play(context.random.pick(grazing ? RICOCHET : WALL))
      }

      const record = {
        entity, weapon: weaponData.id, target, hitbox,
        point: hit.point, normal: hit.normal, distance: hit.distance,
        amount, penetrated
      }
      context.bus.emit('weapon:hit', record)
      return record
    }

    // ------------------------------------------------------------- the verbs
    /**
     * Pull the trigger once.
     *
     * Everything that decides whether a shot happens is here — rate of fire,
     * ammunition, the reload, the deploy — so a bot calling this and a human
     * calling this are held to exactly the same rules. Returns whether a shot
     * left the barrel, which is what a caller wants to know.
     */
    function fire(entity) {
      const bag = inventoryOf(entity, 'fire')
      if (!bag) return false
      const weaponData = table[bag.current]
      if (!weaponData) return false
      if (entity.damageable && entity.damageable.alive === false) return false

      const now = context.time
      if (now < bag.nextShotAt || now < bag.reloadingUntil) return false

      if (weaponData.kind === 'bomb') return false
      if (weaponData.kind === 'throwable') return throwGrenade(entity, bag, weaponData)

      if (weaponData.magazine > 0) {
        if (bag.ammo <= 0) {
          // An empty gun clicking is information, and a player who cannot hear
          // it reloads a round too late for the rest of their life.
          context.play(SOUND + 'menu-click.wav')
          return false
        }
        bag.ammo -= 1
        bag.magazines[weaponData.id] = bag.ammo
      }

      // The pattern returns to its first shot after a moment off the trigger.
      // Tapping is accurate because of this line.
      if (now - bag.lastShotAt > SPRAY_RESET_SECONDS) resetSpray(bag)
      bag.shotsFired += 1
      bag.lastShotAt = now
      bag.nextShotAt = now + (weaponData.roundsPerMinute > 0 ? 60 / weaponData.roundsPerMinute : 0.4)

      // The aim carries the recoil the PREVIOUS shots put on it, and this shot
      // kicks after it has gone. That order is what makes the first bullet of a
      // burst land exactly on the crosshair, which is why tapping works and why
      // a spray has to be pulled down rather than aimed through.
      const aim = aimOf(entity, bag)
      const origin = eyeOf(entity)
      const cone = coneOf(entity, weaponData)
      const along = direction(aim.yaw, aim.pitch)

      context.play(weaponData.sound)
      context.bus.emit('weapon:fired', {
        entity, weapon: weaponData.id, origin, direction: along,
        ammo: bag.ammo, shot: bag.shotsFired
      })

      // A shotgun is nine bullets down one barrel, and that is the only thing
      // that makes it a shotgun: one pellet of an M3 is weaker than a Glock.
      const pellets = weaponData.pellets ?? 1
      const spread = pellets > 1 ? (weaponData.pelletSpread ?? 4) * DEGREES : 0
      for (let pellet = 0; pellet < pellets; pellet++) {
        bullet(entity, weaponData, origin, scatter(aim.yaw, aim.pitch, cone + spread), weaponData.damage)
      }

      applyRecoil(entity, bag, weaponData)
      return true
    }

    /** A grenade leaves the hand rather than the barrel, so it is announced and not raycast. */
    function throwGrenade(entity, bag, weaponData) {
      const held = bag.magazines[weaponData.id] ?? 0
      if (held <= 0) return false

      bag.magazines[weaponData.id] = held - 1
      bag.ammo = held - 1
      bag.nextShotAt = context.time + 1
      const aim = aimOf(entity, bag)
      context.play(weaponData.sound)
      // Where it goes and how it bounces belongs to whoever owns grenades; all
      // this file knows is that one left the hand, from here, pointing there.
      context.bus.emit('weapon:thrown', {
        entity, weapon: weaponData.id,
        origin: eyeOf(entity), direction: direction(aim.yaw, aim.pitch)
      })

      if (bag.ammo <= 0) {
        bag.grenades = bag.grenades.filter(id => id !== weaponData.id)
        select(entity, bag.primary ? 1 : bag.secondary ? 2 : 3)
      }
      return true
    }

    /**
     * Start a magazine change. The behaviour's update hook finishes it, so a
     * reload interrupted by a switch or a death needs nothing cancelled —
     * clearing one number is the whole of it.
     */
    function reload(entity) {
      const bag = inventoryOf(entity, 'reload')
      if (!bag) return false
      const weaponData = table[bag.current]
      if (!weaponData || weaponData.magazine <= 0) return false
      if (context.time < bag.reloadingUntil) return false
      if (bag.ammo >= weaponData.magazine || bag.reserve <= 0) return false

      bag.reloadingUntil = context.time + weaponData.reloadSeconds
      bag.reloadStartedAt = context.time
      bag.reloadStage = 0
      resetSpray(bag)
      return true
    }

    /**
     * Put a weapon in the right slot, with a full magazine and a full reserve.
     *
     * Whatever was in that slot is dropped rather than deleted, because in
     * Counter-Strike a gun you buy over another one lands at your feet for a
     * team-mate — and because deleting it silently is how money disappears.
     */
    function give(entity, id, { select: selectIt = true } = {}) {
      const bag = inventoryOf(entity, 'be given a weapon')
      if (!bag) return false
      const weaponData = table[id]
      if (!weaponData) {
        report(`no-weapon-${id}`, `there is no weapon called "${id}" — the table has ${WEAPONS.length}`)
        return false
      }

      if (weaponData.slot === 'grenade') {
        const held = bag.magazines[id] ?? 0
        if (held >= (weaponData.maximum ?? 1)) return false
        if (!bag.grenades.includes(id)) bag.grenades.push(id)
        bag.magazines[id] = held + 1
        if (bag.current === id) bag.ammo = bag.magazines[id]
        context.play(PICKUP_SOUND)
        return true
      }

      if (weaponData.slot === 'bomb') {
        bag.bomb = id
        context.play(PICKUP_SOUND)
        return true
      }

      const slot = weaponData.slot
      if (bag[slot] && bag[slot] !== id) {
        const previous = bag[slot]
        bag[slot] = null
        // Announced rather than spawned: what a dropped weapon looks like on the
        // floor belongs to whoever owns world models, not to the table.
        context.bus.emit('weapon:dropped', {
          entity, weapon: previous,
          ammo: bag.magazines[previous] ?? 0, reserve: bag.reserves[previous] ?? 0,
          at: { x: entity.x, y: entity.y, z: entity.z }
        })
      }

      bag[slot] = id
      bag.magazines[id] = weaponData.magazine
      bag.reserves[id] = weaponData.reserve
      context.play(PICKUP_SOUND)
      if (selectIt) select(entity, SLOTS.indexOf(slot) + 1)
      return true
    }

    /**
     * Hold a different weapon.
     *
     * The slot may be the number the key is bound to, 1 to 5, or the name. The
     * magazine of what is being put away is kept, because a player who reloads,
     * switches to a knife and switches back should not find a fresh thirty.
     */
    function select(entity, slot) {
      const bag = inventoryOf(entity, 'select a weapon')
      if (!bag) return false

      const name = typeof slot === 'number' ? SLOTS[slot - 1] : slot
      if (!name || !SLOTS.includes(name)) {
        report(`no-slot-${slot}`, `"${slot}" is not a slot — they are ${SLOTS.join(', ')} or 1 to ${SLOTS.length}`)
        return false
      }

      let wanted = null
      if (name === 'grenade') {
        // Pressing the grenade key again moves to the next one held, the way
        // the original cycles through them.
        if (!bag.grenades.length) return false
        const at = bag.grenades.indexOf(bag.current)
        wanted = bag.grenades[(at + 1) % bag.grenades.length]
      } else {
        wanted = bag[name]
      }
      if (!wanted || !table[wanted]) return false
      if (wanted === bag.current && name !== 'grenade') return false

      stow(bag)
      bag.current = wanted
      const weaponData = table[wanted]
      bag.ammo = bag.magazines[wanted] ?? weaponData.magazine
      bag.reserve = bag.reserves[wanted] ?? weaponData.reserve
      bag.moveSpeedFactor = weaponData.moveSpeedFactor
      bag.nextShotAt = context.time + weaponData.deploySeconds
      bag.reloadingUntil = 0
      resetSpray(bag)
      context.play(DEPLOY_SOUND)
      context.bus.emit('weapon:selected', { entity, weapon: wanted })
      return true
    }

    /** Remember what the weapon being put away had left in it. */
    function stow(bag) {
      if (!bag.current) return
      bag.magazines[bag.current] = bag.ammo
      bag.reserves[bag.current] = bag.reserve
    }

    /**
     * Put the current weapon on the floor.
     *
     * The knife is refused: a player with no knife has no way to move at full
     * speed and no last resort, and the original refuses it for the same reason.
     */
    function drop(entity) {
      const bag = inventoryOf(entity, 'drop a weapon')
      if (!bag) return false
      const weaponData = table[bag.current]
      if (!weaponData || weaponData.slot === 'knife') return false

      stow(bag)
      const dropped = bag.current
      if (weaponData.slot === 'grenade') {
        bag.grenades = bag.grenades.filter(id => id !== dropped)
        bag.magazines[dropped] = 0
      } else {
        bag[weaponData.slot] = null
      }

      context.bus.emit('weapon:dropped', {
        entity, weapon: dropped,
        ammo: bag.magazines[dropped] ?? 0, reserve: bag.reserves[dropped] ?? 0,
        at: { x: entity.x, y: entity.y, z: entity.z }
      })

      bag.current = ''
      select(entity, bag.primary ? 1 : bag.secondary ? 2 : 3)
      return true
    }

    context.weapons = {
      table,
      get: id => table[id] ?? null,
      give, fire, reload, select, drop, prepare,
      // Offered so the damage lane has one implementation to call rather than a
      // second one to maintain. See damageTo above for why that matters.
      damageTo: (id, situation) => damageTo(table[id] ?? table.knife, situation),
      falloff: (id, distance) => falloff(table[id] ?? table.knife, distance),
      hitboxAt,
      slots: SLOTS,
      // Published rather than left as a private constant, because the carrying
      // behaviour has to let the spray go cold at exactly the moment the trigger
      // does. Two copies of this number would show up as a crosshair that opens
      // back up a frame before or after the pattern actually resets.
      sprayResetSeconds: SPRAY_RESET_SECONDS
    }
    running = { weapons: context.weapons, context }

    // The game's own art, named here rather than in the builtin: the engine
    // ships textureless effects and decals, and a game that wants its own look
    // says so in its own plugin. The muzzle flash sprite and the hole and blood
    // decals are this game's pictures.
    if (context.particles) {
      context.particles.define('muzzle-flash', { texture: 'counter-strike/muzzle-flash.png' })
      context.particles.art.bulletHole = 'counter-strike/decal-bullet-hole.png'
      context.particles.art.blood = 'counter-strike/decal-blood.png'
    }

    // The shelf's game-specific tools, named here rather than in the builtin.
    if (context.tools?.register) {
      context.tools.register({ name: 'counter-strike-sounds', file: 'tools/make-counter-strike-sounds.mjs', wrapped: false, makes: 'the Counter-Strike sound set', run: 'node tools/make-counter-strike-sounds.mjs' })
      context.tools.register({ name: 'counter-strike-textures', file: 'tools/make-counter-strike-textures.mjs', wrapped: false, makes: 'the Counter-Strike textures', run: 'node tools/make-counter-strike-textures.mjs' })
    }
  },

  commands: [
    {
      id: 'weapons.table',
      label: 'Every weapon and what it costs',
      // A count and one line each, not the whole table: an agent asking "what
      // exists" should not have to pay for thirty recoil arrays to find out.
      run: context => Object.values(context.weapons.table).map(w => ({
        id: w.id, slot: w.slot, price: w.price, damage: w.damage,
        armourPenetration: w.armourPenetration, roundsPerMinute: w.roundsPerMinute,
        magazine: w.magazine, moveSpeedFactor: w.moveSpeedFactor, team: w.team
      }))
    },
    {
      id: 'weapons.carrying',
      label: 'What an entity is holding',
      run: (context, id) => {
        const entity = context.world.byId(id)
        if (!entity) return { error: `no entity "${id}"` }
        const bag = entity.carriesWeapons
        if (!bag) return { error: `${id} has no "carries-weapons" behaviour` }
        return {
          current: bag.current, ammo: bag.ammo, reserve: bag.reserve,
          primary: bag.primary, secondary: bag.secondary, knife: bag.knife,
          grenades: bag.grenades, bomb: bag.bomb,
          moveSpeedFactor: bag.moveSpeedFactor, shotsFired: bag.shotsFired
        }
      }
    }
  ]
}

// ------------------------------------------------------------------ helpers
/**
 * Everything the spray and the reload have to forget between bursts, in one
 * place, so a burst that ends by switching weapons forgets exactly as much as
 * one that ends by letting go of the trigger.
 */
export function resetSpray(bag) {
  bag.shotsFired = 0
  bag.recoilPitch = 0
  bag.recoilYaw = 0
}

/**
 * Is this something a bullet can hurt? A team or a `damageable` bag says yes;
 * a wall has neither.
 */
const damageableEntity = entity =>
  !!entity && (!!entity.damageable || !!entity.properties?.team)

/** The camera's convention, written out again because a shot must not guess it. */
const direction = (yaw, pitch) => {
  const flat = Math.cos(pitch)
  return { x: -Math.sin(yaw) * flat, y: Math.sin(pitch), z: -Math.cos(yaw) * flat }
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z

/** A three-number collider box is the one flag that says an entity is 3D. */
function colliderHeight(entity) {
  const box = entity?.collider?.box
  if (!Array.isArray(box)) return 0
  return (box[1] ?? 0) * (entity.scale ?? 1)
}

/** Crouching is a plain field, which is how two plugins that must agree talk here. */
const crouching = entity => entity?.crouched === true || entity?.properties?.crouched === true
