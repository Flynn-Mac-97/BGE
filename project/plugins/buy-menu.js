/**
 * Buy Menu — the numbered text menu from Counter-Strike 1.6, key for key.
 *
 * B, 4, 3 is an AK-47. That sequence is muscle memory for a generation of
 * players, and it is why this is a numbered list rather than a grid of pictures
 * you point at. Typing it fast while the freeze timer runs down is part of
 * playing the round; a shop you browse with a mouse would quietly delete that.
 * So the hierarchy, the numbers and the Backspace-goes-up rule are reproduced
 * exactly, and the drawing is deliberately plain: monospace, pale yellow on
 * dark, one price to the right of every line.
 *
 * An item you cannot afford is greyed, never hidden. Knowing that the AWP is
 * there and that you are eight hundred dollars short is information you use to
 * decide whether to save — hiding it would be hiding the decision. An item the
 * other team buys IS hidden, because the two teams have two different menus and
 * always have: the number that means AK-47 to a terrorist means M4A1 to a
 * counter-terrorist, and that restriction is load-bearing for the balance of
 * the whole game.
 *
 * Two ways in, one set of rules:
 *
 *   context.buyMenu.buy(entity, id)   the plain one, and the only one that buys
 *   B and the number keys             which end up calling exactly that
 *
 * A bot never opens a menu; it calls `buy`. So every rule about money, team,
 * buy time, buy zone and one-primary-only lives inside `buy`, and none of it
 * lives in the drawing code. A rule that lived in the keyboard path would mean
 * the human and the bot were playing two different games, and neither could be
 * balanced against the other.
 *
 * It draws into its own canvas layer, the way `plugins/builtin/hud.js` does and
 * for the same reasons — one rectangle of pixels that a screenshot and
 * `snapshot()` both see, and its own element so another plugin rebuilding the
 * viewport cannot delete it. Nothing here is styled DOM.
 */

/**
 * How far from your own team's spawn you may still buy, in metres.
 *
 * Counter-Strike draws buy zones as brushes in the map; this level format has
 * no such brush, and the spawn points it does have sit exactly where those
 * brushes do. Eight metres covers a whole spawn cluster — the five terrorist
 * spawns on de_dust2 span about twelve metres — and a few paces beyond it,
 * which is what the real zone does.
 *
 * A level with no spawn points for your team has not said where buying is
 * allowed, so everywhere is. A level that never states a rule is not a level
 * that forbids everything.
 */
const BUY_ZONE_RADIUS = 8

/**
 * How long into a live round you may still buy, in seconds.
 *
 * mp_buytime defaults to 1.5 minutes in 1.6, measured from the round going
 * live. Freeze time is always buy time, and once a round has ended nothing can
 * be bought at all.
 */
const BUY_SECONDS_AFTER_ROUND_START = 90

/** How long a refusal — "you are not in a buy zone" — stays on screen. */
const NOTICE_SECONDS = 2

/**
 * The number keys, bound as this plugin's own actions rather than borrowed.
 *
 * `slot1`..`slot5` already mean Digit1..Digit5 to whoever is switching weapons,
 * and the menu needs 6 through 0 as well. Half a set borrowed and half a set
 * invented is the version that breaks the day another lane rebinds a slot, so
 * the menu binds every digit it reads — and announces on the bus when it has
 * them, which is what stops a 3 from picking an AK-47 and drawing a knife.
 */
const MENU_KEYS = {
  buyMenuDigit1: ['Digit1', 'Numpad1'],
  buyMenuDigit2: ['Digit2', 'Numpad2'],
  buyMenuDigit3: ['Digit3', 'Numpad3'],
  buyMenuDigit4: ['Digit4', 'Numpad4'],
  buyMenuDigit5: ['Digit5', 'Numpad5'],
  buyMenuDigit6: ['Digit6', 'Numpad6'],
  buyMenuDigit7: ['Digit7', 'Numpad7'],
  buyMenuDigit8: ['Digit8', 'Numpad8'],
  buyMenuDigit9: ['Digit9', 'Numpad9'],
  buyMenuDigit0: ['Digit0', 'Numpad0'],
  buyMenuBack: ['Backspace']
}

/** Every action this plugin watches, in one list, so releases are tracked too. */
const WATCHED = ['buy', ...Object.keys(MENU_KEYS)]

/**
 * Everything that can be bought, and what it costs. The prices are 1.6's.
 *
 * `kind` is what buying it does rather than what it looks like: one primary at
 * a time is a rule about primaries, and it holds for a shotgun exactly as it
 * holds for a rifle.
 *
 * A price here is a fallback. When the weapons lane declares a price on its own
 * table entry that price wins, because two copies of a number are one number
 * and one lie waiting to happen.
 */
const ITEMS = {
  glock18: { name: 'Glock-18', price: 400, kind: 'secondary' },
  usp: { name: 'USP45', price: 500, kind: 'secondary' },
  p228: { name: 'P228', price: 600, kind: 'secondary' },
  deagle: { name: 'Desert Eagle', price: 650, kind: 'secondary' },
  fiveseven: { name: 'Five-Seven', price: 750, kind: 'secondary' },
  elites: { name: 'Dual Elites', price: 800, kind: 'secondary' },

  m3: { name: 'M3 Super 90', price: 1700, kind: 'primary' },
  xm1014: { name: 'XM1014', price: 3000, kind: 'primary' },

  mp5navy: { name: 'MP5 Navy', price: 1500, kind: 'primary' },
  tmp: { name: 'Steyr TMP', price: 1250, kind: 'primary' },
  mac10: { name: 'MAC-10', price: 1400, kind: 'primary' },
  ump45: { name: 'UMP45', price: 1700, kind: 'primary' },
  p90: { name: 'P90', price: 2350, kind: 'primary' },

  galil: { name: 'Galil', price: 2000, kind: 'primary' },
  famas: { name: 'FAMAS', price: 2250, kind: 'primary' },
  scout: { name: 'Scout', price: 2750, kind: 'primary' },
  ak47: { name: 'AK-47', price: 2500, kind: 'primary' },
  m4a1: { name: 'M4A1', price: 3100, kind: 'primary' },
  sg552: { name: 'SG-552', price: 3500, kind: 'primary' },
  aug: { name: 'AUG', price: 3500, kind: 'primary' },
  sg550: { name: 'SG-550', price: 4200, kind: 'primary' },
  g3sg1: { name: 'G3SG1', price: 5000, kind: 'primary' },
  awp: { name: 'AWP', price: 4750, kind: 'primary' },

  m249: { name: 'M249 Para', price: 5750, kind: 'primary' },

  kevlar: { name: 'Kevlar Vest', price: 650, kind: 'armour' },
  'kevlar-helmet': { name: 'Kevlar + Helmet', price: 1000, kind: 'armour', helmet: true },
  'defusal-kit': { name: 'Defusal Kit', price: 200, kind: 'gear', field: 'defusalKit' },
  nightvision: { name: 'Night Vision', price: 1250, kind: 'gear', field: 'nightVision' },

  hegrenade: { name: 'HE Grenade', price: 300, kind: 'grenade', carry: 1 },
  flashbang: { name: 'Flashbang', price: 200, kind: 'grenade', carry: 2 },
  smokegrenade: { name: 'Smoke Grenade', price: 300, kind: 'grenade', carry: 1 },

  // One reload for whatever you are holding. 1.6 prices ammunition by calibre;
  // when the weapons lane declares `ammoPrice` on a weapon that number wins,
  // and these two are the rifle and pistol clip prices it falls back to.
  'primary-ammunition': { name: 'Primary Ammunition', price: 60, kind: 'ammunition', slot: 'primary' },
  'secondary-ammunition': { name: 'Secondary Ammunition', price: 40, kind: 'ammunition', slot: 'secondary' }
}

/**
 * The menu itself: nine numbered entries, and what each of them opens.
 *
 * Where the two teams differ the whole list is written out per team rather than
 * filtered out of one shared list, because the numbering is the part that
 * matters. A terrorist's 4-3 is an AK-47 and a counter-terrorist's 4-3 is an
 * M4A1 — the same key, a different rifle, the same position in the list.
 * Filtering one list would shuffle everything below the first difference and
 * break every sequence anybody has memorised.
 */
const MENU = [
  {
    number: 1,
    title: 'Pistols',
    items: {
      terrorist: ['glock18', 'usp', 'p228', 'deagle', 'elites'],
      'counter-terrorist': ['glock18', 'usp', 'p228', 'deagle', 'fiveseven']
    }
  },
  { number: 2, title: 'Shotguns', items: ['m3', 'xm1014'] },
  {
    number: 3,
    title: 'Sub-machine guns',
    items: {
      terrorist: ['mp5navy', 'mac10', 'ump45', 'p90'],
      'counter-terrorist': ['mp5navy', 'tmp', 'ump45', 'p90']
    }
  },
  {
    number: 4,
    title: 'Rifles',
    items: {
      terrorist: ['galil', 'scout', 'ak47', 'sg552', 'awp', 'g3sg1'],
      'counter-terrorist': ['famas', 'scout', 'm4a1', 'aug', 'sg550', 'awp']
    }
  },
  { number: 5, title: 'Machine guns', items: ['m249'] },
  { number: 6, title: 'Primary ammunition', buys: 'primary-ammunition' },
  { number: 7, title: 'Secondary ammunition', buys: 'secondary-ammunition' },
  {
    number: 8,
    title: 'Equipment',
    items: {
      terrorist: ['kevlar', 'kevlar-helmet', 'nightvision'],
      'counter-terrorist': ['kevlar', 'kevlar-helmet', 'defusal-kit', 'nightvision']
    }
  },
  { number: 9, title: 'Grenades', items: ['hegrenade', 'flashbang', 'smokegrenade'] }
]

const TEAMS = ['terrorist', 'counter-terrorist']

/** The ids a category offers this team, in menu order. */
const itemsFor = (category, team) =>
  !category?.items ? [] : Array.isArray(category.items) ? category.items : (category.items[team] || [])

/** Every id a team may buy at all — the team restriction, derived in one place. */
function allowedFor(team) {
  const allowed = new Set()
  for (const category of MENU) {
    for (const id of itemsFor(category, team)) allowed.add(id)
    if (category.buys) allowed.add(category.buys)
  }
  return allowed
}

const ALLOWED = Object.fromEntries(TEAMS.map(team => [team, allowedFor(team)]))

/**
 * The live menu and the key reader, published on the module.
 *
 * A test is handed a `test` object and no context, so this is how
 * `project/tests/buy-menu.js` reaches the same menu the game reaches rather
 * than a second copy of it — the same reason `plugins/builtin/mouse-look.js`
 * publishes its input surface. A test with its own copy of the rules passes
 * happily while the rules the game runs are broken. The systems below read
 * `readKeys` from here for the same reason `camera.js` does: a contribution
 * point is declared on the module, and the state it drives is made in onLoad.
 *
 * `bus` is here so a test can hear the announcement below rather than take it
 * on trust. An event nobody ever listens for is an event that can quietly stop
 * being emitted.
 */
export const buyMenu = { menu: null, readKeys: null, bus: null }

export default {
  name: 'Buy Menu',
  needs: ['Keyboard Input', 'Mouse Look'],

  onLoad(context) {
    const input = context.input
    if (!input) {
      console.error('[buy-menu] Keyboard Input did not load, so there are no keys to read — B will do nothing and the menu can only be reached through context.buyMenu.buy(). Check plugins.list for why it failed.')
    } else {
      for (const [action, codes] of Object.entries(MENU_KEYS)) input.bind(action, codes)
      // Mouse Look owns the B binding; bind it here if that plugin is missing,
      // rather than leave the one key everybody reaches for doing nothing.
      if (!input.codes('buy').length) {
        input.bind('buy', ['KeyB'])
        console.error('[buy-menu] nothing had bound the "buy" action, so B is bound here as a fallback — Mouse Look normally owns it.')
      }
    }

    // Faults already reported, so a player placed with no team says so once
    // rather than sixty times a second.
    const scolded = new Set()

    // `category` is the submenu you are inside, or null at the top level.
    const state = { open: false, entity: null, category: null, notice: '', noticeUntil: -1 }

    const showNotice = text => {
      state.notice = text
      state.noticeUntil = context.time + NOTICE_SECONDS
    }

    // ------------------------------------------------------------ who is buying
    /**
     * The entity the menu is for. The camera follows whoever you are playing,
     * which is a plain read of a field another plugin already keeps, and the
     * first player in the level is the answer before anything follows one.
     *
     * The target is checked against the world because a camera left pointing at
     * an entity from the last level would otherwise open a buy menu for a
     * player who no longer exists — and every rule below would then be applied
     * to a ghost.
     */
    const localPlayer = () => {
      const followed = context.camera?.target
      if (followed && context.world.byId(followed.id) === followed) return followed
      // Whoever a human is driving, before the camera has caught up with the
      // level's follow rule. `behaviours` is a plain list on the entity, so
      // this is a field read rather than one behaviour looking another up —
      // and it does not care whether the body is a terrorist, a
      // counter-terrorist or the demo's own `player`.
      const driven = context.world.entities
        .find(entity => entity.behaviours?.some(attached => attached.name === 'player-controlled'))
      return driven || context.world.all('player')[0] || null
    }

    const teamOf = entity => entity?.properties?.team || null

    // ------------------------------------------------------------------- money
    /**
     * Money belongs to the match lane, which keeps it in `entity.money`.
     *
     * The same three places the HUD looks, in the same order, so the number on
     * screen and the number a purchase is checked against can never be two
     * different numbers. Until match rules load, the plain field on the entity
     * is still the whole ledger and a test can still arrange one.
     */
    const moneyOf = entity => {
      if (typeof context.match?.money === 'function') return context.match.money(entity) ?? 0
      if (Number.isFinite(entity?.money)) return entity.money
      return entity?.properties?.money ?? 0
    }

    /** Spending is being paid a negative amount, so there is one ledger and not two. */
    const spend = (entity, amount, reason) => {
      if (typeof context.match?.pay === 'function') { context.match.pay(entity, -amount, reason); return }
      const left = moneyOf(entity) - amount
      if (Number.isFinite(entity.money) || !Number.isFinite(entity.properties?.money)) entity.money = left
      else entity.properties.money = left
    }

    /** The weapons table's price when it declares one, this file's when it does not. */
    const priceOf = id => {
      const item = ITEMS[id]
      if (!item) return 0
      const declared = context.weapons?.get?.(id)
      const fromTable = item.kind === 'ammunition' ? declared?.ammoPrice : declared?.price
      return Number.isFinite(fromTable) ? fromTable : item.price
    }

    /**
     * What to call it on screen, and the table's word for it wins.
     *
     * A gun with two names is a gun somebody will one day rename in one place
     * only. Armour, night vision and ammunition are not weapons and are not in
     * that table, so those names live here.
     */
    const nameOf = id => context.weapons?.get?.(id)?.name || ITEMS[id]?.name || id

    // --------------------------------------------------------------- buy time
    // The phase, read from the shared bag first.
    //
    // The match lane publishes the same word into world.state so the HUD can
    // show it, and the shared bag is the version everything else in the game
    // can already see — `engine.mjs run hud.read` answers with it, and a test
    // arranges a round by writing one plain field. Reading it first means the
    // rule and the scoreboard cannot disagree about what phase it is. The match
    // object itself is the fallback for the moment before the first mirror.
    let lastPhase
    let liveSince = 0
    const phaseNow = () => context.world.state?.phase ?? context.match?.phase ?? null

    const isBuyTime = () => {
      const phase = phaseNow()
      if (phase !== lastPhase) {
        lastPhase = phase
        if (phase === 'live') liveSince = context.time
      }
      // No match rules loaded means there are no rounds to be outside of.
      if (phase == null) return true
      if (phase === 'warmup' || phase === 'freeze') return true
      if (phase === 'live') return context.time - liveSince <= BUY_SECONDS_AFTER_ROUND_START
      return false
    }

    // --------------------------------------------------------------- buy zone
    const inBuyZone = entity => {
      const team = teamOf(entity)
      if (!entity || !team) return false
      const spawns = context.world.all('spawn-point').filter(s => s.properties?.team === team)
      if (!spawns.length) return true
      // Flat distance: standing on a crate in your own spawn is still your own
      // spawn, and height has nothing to do with where a buy zone is drawn.
      return spawns.some(spawn => {
        const alongX = entity.x - spawn.x
        const alongZ = entity.z - spawn.z
        return alongX * alongX + alongZ * alongZ <= BUY_ZONE_RADIUS * BUY_ZONE_RADIUS
      })
    }

    // -------------------------------------------------------------- inventory
    /**
     * What primary this entity carries, as an id.
     *
     * `entity.carriesWeapons` belongs to the carrying lane, and reading a plain
     * field on the entity is exactly how two behaviours are allowed to agree.
     * It is read tolerantly because that bag may hold an id or the weapon
     * itself, and one primary at a time is too important a rule to fail over a
     * shape.
     */
    const idOf = held => (typeof held === 'string' ? held : held?.id || null)
    const primaryOf = entity => idOf(entity?.carriesWeapons?.primary)

    /**
     * The bag is never invented here when the weapons lane is loaded.
     *
     * `carries-weapons` keeps more in it than a slot per weapon — magazines,
     * reserves, a spray counter — and a half-made bag handed to `give` is worse
     * than no bag at all, because the complaint it would have made about a
     * missing behaviour never happens and something further down crashes
     * instead. So a bag is only ever made on the path where nothing else keeps
     * one, and the real one is left to its owner.
     */
    const carriedBy = entity => {
      if (!entity.carriesWeapons) entity.carriesWeapons = { grenades: [] }
      if (!Array.isArray(entity.carriesWeapons.grenades)) entity.carriesWeapons.grenades = []
      return entity.carriesWeapons
    }

    /** How many of one grenade is held, counted from whichever shape the bag keeps. */
    const grenadesHeld = (entity, id) => {
      const bag = entity?.carriesWeapons
      if (!bag) return 0
      if (Number.isFinite(bag.magazines?.[id])) return bag.magazines[id]
      return Array.isArray(bag.grenades) ? bag.grenades.filter(held => idOf(held) === id).length : 0
    }

    /** How many of one grenade may be held — the weapons table's number, then this file's. */
    const grenadeLimit = (id, item) => context.weapons?.get?.(id)?.maximum ?? item.carry

    const reserveOf = (bag, weaponId) =>
      Number.isFinite(bag?.reserves?.[weaponId]) ? bag.reserves[weaponId] : (bag?.reserve ?? 0)

    /**
     * Hand the thing over, and say whether it went. The weapons lane does it
     * when it is loaded and the plain fields it would have written are the
     * fallback when it is not, so the same purchase leaves the same entity in
     * the same state either way.
     *
     * It returns false rather than throwing when the entity cannot take the
     * thing, and `buy` charges nobody for a delivery that did not happen.
     */
    function deliver(entity, id, item) {
      if (item.kind === 'primary' || item.kind === 'secondary' || item.kind === 'grenade') {
        // `give` puts it in the right slot, drops whatever that slot held, puts
        // it in your hands and makes the pickup noise — all of which is its job
        // and none of which is worth a second copy here.
        if (typeof context.weapons?.give === 'function') return context.weapons.give(entity, id) !== false
        const carried = carriedBy(entity)
        if (item.kind === 'grenade') carried.grenades.push(id)
        else carried[item.kind] = id
        context.play?.('assets/counter-strike/sounds/pickup-weapon.wav', { entity })
        return true
      }

      if (item.kind === 'ammunition') {
        const bag = entity.carriesWeapons
        const weaponId = idOf(bag?.[item.slot])
        if (!weaponId) return false
        // Fill the reserve to what the weapon holds, or add a magazine when
        // nothing has said how much that is.
        const weaponData = context.weapons?.get?.(weaponId)
        const topped = Number.isFinite(weaponData?.reserve)
          ? weaponData.reserve
          : reserveOf(bag, weaponId) + (weaponData?.magazine ?? 30)
        if (bag.reserves) bag.reserves[weaponId] = topped
        if (bag.current === weaponId || !bag.reserves) bag.reserve = topped
        context.play?.('assets/counter-strike/sounds/pickup-ammo.wav', { entity })
        return true
      }

      if (item.kind === 'armour') {
        // The damage lane's bag, by the same plain-field agreement. Armour is a
        // hundred points in 1.6 whether or not a helmet came with it, and
        // buying a vest alone never takes a helmet off.
        const damageable = entity.damageable || entity.properties
        damageable.armour = 100
        if (item.helmet) damageable.helmet = true
        context.play?.('assets/counter-strike/sounds/pickup-weapon.wav', { entity })
        return true
      }

      entity.properties[item.field] = true
      context.play?.('assets/counter-strike/sounds/pickup-weapon.wav', { entity })
      return true
    }

    // ------------------------------------------------------------------- buy
    /**
     * The one door. A bot walks through this and so does every key press, so
     * there is no arrangement of money, team and inventory a bot can reach and
     * a human cannot.
     *
     * Refusals are returned rather than thrown: being short of money is an
     * ordinary thing that happens on the first round of every half, not a
     * fault. A genuine fault — an id nobody sells, an entity on no team — says
     * so by name on the console as well, because a menu that does nothing and
     * explains nothing is the worst thing this could hand anyone.
     *
     * Every refusal carries a `refused` word as well as a sentence. The
     * sentence is for the player and may be reworded; the word is what a bot,
     * a test or a terminal reads, so "it was the team rule, not the money" is
     * answerable without matching on prose.
     */
    function buy(entity, id) {
      if (!entity) return fault('no-buyer', 'there is nobody to buy for', 'no-entity')

      const item = ITEMS[id]
      if (!item) return fault('unknown-item', `nothing called "${id}" is for sale`, `unknown-${id}`)

      const name = nameOf(id)
      const team = teamOf(entity)
      if (!team) {
        return fault('no-team', `${entity.id} has no properties.team, so it is on neither team's buy list`, entity.id)
      }
      if (!ALLOWED[team]?.has(id)) return no('team', `a ${team} cannot buy the ${name}`)

      if (!isBuyTime()) return no('buy-time', 'buy time is over')
      if (!inBuyZone(entity)) return no('buy-zone', 'you are not in a buy zone')

      const price = priceOf(id)
      const money = moneyOf(entity)
      if (money < price) return no('money', `the ${name} costs $${price} and you have $${money}`)

      if (item.kind === 'grenade' && grenadesHeld(entity, id) >= grenadeLimit(id, item)) {
        return no('carrying', `you already carry every ${name.toLowerCase()} you can`)
      }

      // One primary at a time. Buying a second drops the first where you stand,
      // with no refund — exactly as the game does it, which is what makes
      // upgrading mid-round a real decision rather than a free swap. The drop
      // itself belongs to whoever owns the slot, so this only remembers what
      // was there in order to report it.
      const dropped = item.kind === 'primary' ? primaryOf(entity) : null

      if (!deliver(entity, id, item)) {
        return no('cannot-carry', `${entity.id} cannot take the ${name} right now`)
      }
      // Charged only once the thing is actually in hand. Charging first and
      // discovering afterwards that it could not be carried is how money goes
      // missing with nothing to show for it.
      spend(entity, price, `bought ${name}`)
      context.bus.emit('buy-menu:bought', { entity, id, price, dropped })

      return { ok: true, id, name, price, dropped, money: moneyOf(entity) }
    }

    /** An ordinary no: something a player does every round, said plainly. */
    const no = (refused, reason) => ({ ok: false, refused, reason })

    /** A no that is a bug in a level or a caller, said by name on the console and said once. */
    function fault(refused, reason, key) {
      if (!scolded.has(key)) {
        scolded.add(key)
        console.error(`[buy-menu] ${reason}`)
      }
      return { ok: false, refused, reason }
    }

    // -------------------------------------------------------------- the menu
    const blip = () => context.play?.('assets/counter-strike/sounds/menu-click.wav')

    /** Put the refusal where the player is looking, and hand it back unchanged. */
    const showRefusal = result => { showNotice(result.reason); return result }

    /**
     * Opening is announced on the bus, and that is the whole point of the event.
     *
     * While the menu is up the number keys belong to it, so whoever switches
     * weapons on slot1..slot5 has to stand down. It cannot be told directly:
     * one plugin reaching into another lane's state is the component graph this
     * engine refuses to become. So it is said once, out loud, and anyone who
     * cares listens — the menu never learns who that is.
     */
    function open(entity = localPlayer()) {
      if (!entity) return fault('no-buyer', 'there is nobody to buy for', 'no-entity')

      // The same two gates `buy` applies, asked before the menu appears rather
      // than after nine keystrokes. They are still checked inside `buy`, which
      // is what a bot calls and what the round could change under a menu left
      // standing open.
      if (!isBuyTime()) return showRefusal(no('buy-time', 'buy time is over'))
      if (!inBuyZone(entity)) return showRefusal(no('buy-zone', 'you are not in a buy zone'))

      state.open = true
      state.entity = entity
      state.category = null
      blip()
      context.bus.emit('buy-menu:opened', entity)
      return { ok: true }
    }

    function close() {
      if (!state.open) return
      state.open = false
      state.entity = null
      state.category = null
      context.bus.emit('buy-menu:closed')
    }

    /** Backspace: up one level, and out of the menu altogether from the top. */
    function back() {
      if (!state.open) return
      blip()
      if (state.category) state.category = null
      else close()
    }

    /**
     * One numbered key. 0 always cancels outright, wherever you are — the
     * original's "0. Exit" — while Backspace is the one that climbs a level.
     */
    function press(number) {
      if (!state.open) return no('closed', 'the menu is not open')
      blip()

      if (number === 0) { close(); return { ok: true, closed: true } }

      let id = null
      if (!state.category) {
        const category = MENU.find(c => c.number === number)
        if (!category) return no('no-entry', `there is no ${number} on this list`)
        if (!category.buys) { state.category = category; return { ok: true, category: category.title } }
        id = category.buys
      } else {
        id = itemsFor(state.category, teamOf(state.entity))[number - 1]
        if (!id) return no('no-entry', `there is no ${number} on this list`)
      }

      const result = buy(state.entity, id)
      // The original closes the moment you buy something and leaves you in the
      // list when it refuses, so you can pick something you can afford instead.
      if (result.ok) close()
      else showRefusal(result)
      return result
    }

    /**
     * What is on the screen right now, as data.
     *
     * The painter renders this and the `buy.menu` command prints it, so an
     * agent reads the menu with `engine.mjs run buy.menu` instead of with a
     * screenshot — and what it reads is exactly what a player sees.
     */
    function view() {
      const entity = state.entity || localPlayer()
      const money = entity ? moneyOf(entity) : 0
      const notice = context.time <= state.noticeUntil ? state.notice : ''
      if (!state.open) return { open: false, money, notice, heading: '', rows: [] }

      const cancel = { number: 0, id: null, name: 'Cancel', price: null, affordable: true }

      if (!state.category) {
        return {
          open: true,
          money,
          notice,
          heading: 'Buy',
          rows: MENU.map(category => ({
            number: category.number,
            id: category.buys ?? null,
            name: category.title,
            price: category.buys ? priceOf(category.buys) : null,
            affordable: category.buys ? money >= priceOf(category.buys) : true
          })).concat(cancel)
        }
      }

      return {
        open: true,
        money,
        notice,
        heading: state.category.title,
        // The id travels with the row, so a terminal reading `buy.menu` can act
        // on what it sees without matching a display name back to a weapon.
        rows: itemsFor(state.category, teamOf(entity)).map((id, index) => ({
          number: index + 1,
          id,
          name: nameOf(id),
          price: priceOf(id),
          affordable: money >= priceOf(id)
        })).concat(cancel)
      }
    }

    // ------------------------------------------------------------- the keys
    /**
     * `pressed`, and each press acted on once.
     *
     * `pressed` means "went down since the last frame", which is exactly the
     * question a menu asks — `held` would buy sixty rifles out of one tap,
     * because one `simulate(1)` is sixty fixed steps with the key down for all
     * of them. But a frame can contain many fixed steps, and `pressed` stays
     * true across all of them, so a press is also marked as spent.
     *
     * The marks are cleared on `step:end`, which is the same event that clears
     * the keyboard's own list — one lifetime for both, rather than a second
     * rule here that could outlive it and swallow the next press.
     */
    const spent = new Set()
    context.bus.on('step:end', () => spent.clear())

    function readKeys() {
      for (const action of WATCHED) {
        if (!input?.pressed(action)) continue
        if (spent.has(action)) continue
        spent.add(action)

        if (action === 'buy') { state.open ? close() : open(); continue }
        if (!state.open) continue
        if (action === 'buyMenuBack') { back(); continue }
        press(Number(action.slice(-1)))
      }
    }

    const menu = {
      buy,
      open,
      close,
      back,
      press,
      view,
      isBuyTime,
      inBuyZone,
      priceOf,
      moneyOf,
      primaryOf,
      /** Who pressing B would open the menu for, without opening it. */
      buyer: localPlayer,
      /** What this team is offered, so a bot picks from the list a player sees. */
      offered: team => [...(ALLOWED[team] || [])],
      get isOpen() { return state.open },
      get entity() { return state.entity },
      get category() { return state.category?.title || null }
    }

    context.buyMenu = menu
    buyMenu.menu = menu
    buyMenu.readKeys = readKeys
    buyMenu.bus = context.bus

    // A menu left standing open into the next round would take the number keys
    // from a player who is already running.
    context.bus.on('level:loaded', close)
    context.bus.on('play:stopped', close)
  },

  systems: [
    {
      // Fixed, because it buys things: a purchase has to land on the same step
      // on every replay or simulate() stops repeating.
      phase: 'fixed',
      run: () => buyMenu.readKeys?.()
    },
    {
      // Frame, because it only draws. Nothing here may change the simulation.
      phase: 'frame',
      run(world, seconds, context) {
        const menu = context.buyMenu
        if (!menu) return
        const layer = ensureLayer(context)
        if (!layer) return

        const shown = menu.view()
        // Repaint only when the picture changed. A menu that redraws every
        // frame is an easy way to make a 60fps game run at 40.
        const key = `${JSON.stringify(shown)}|${layer.canvas.clientWidth}x${layer.canvas.clientHeight}`
        if (key === layer.last) return
        layer.last = key
        paint(layer, shown)
      }
    }
  ],

  commands: [
    {
      id: 'buy.menu',
      label: 'What the buy menu says',
      run: context => context.buyMenu.view()
    },
    {
      id: 'buy.buy',
      label: 'Buy something for an entity',
      // args: [entityId, itemId] — the same door a bot uses, from a terminal
      run(context, args) {
        const [entityId, id] = [].concat(args ?? [])
        const entity = entityId ? context.world.byId(entityId) : null
        if (entityId && !entity) return { ok: false, reason: `no entity "${entityId}"` }
        return context.buyMenu.buy(entity, id)
      }
    }
  ]
}

// ------------------------------------------------------------------ the layer
/**
 * A 2D canvas sitting exactly on the viewport, and its own — never shared.
 *
 * The same arrangement `hud.js` uses, for the same reason: the Transform Tool
 * rewrites the shell's overlay wholesale, so anything drawn into it disappears.
 * Two plugins drawing into one container is a shared-mutable-DOM bug waiting to
 * happen, so each keeps its own rectangle of pixels.
 */
function ensureLayer(context) {
  // No document, no drawing — and that is not an error. A headless world runs
  // every rule above this line and simply has nothing to show them on.
  if (typeof document === 'undefined') return null

  const existing = context.buyMenu._layer
  if (existing && document.contains(existing.canvas)) return existing

  const host = context.shell?.viewport
  if (!host) return null

  const canvas = existing?.canvas || document.createElement('canvas')
  canvas.className = 'buy-menu-layer'
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  host.prepend(canvas)
  // The GL canvas is first; keep this after it, as the HUD does.
  const gl = host.querySelector('#gl')
  if (gl) gl.after(canvas)

  const layer = { canvas, g: canvas.getContext('2d'), last: null }
  context.buyMenu._layer = layer
  return layer
}

/** The original's colours: pale yellow on near-black, grey for what you cannot afford. */
const COLOURS = {
  panel: 'rgba(6, 8, 6, 0.82)',
  edge: 'rgba(255, 224, 138, 0.30)',
  heading: '#ffe08a',
  line: '#e6d7a2',
  spent: '#6f6a55',
  money: '#9fd77a'
}

const FONT_SIZE = 15
const LINE_HEIGHT = 21
const PANEL_WIDTH = 320
const PADDING = 14

function paint(layer, shown) {
  const { canvas, g } = layer
  const ratio = Math.min(devicePixelRatio || 1, 2)
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio
    canvas.height = height * ratio
  }

  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  g.clearRect(0, 0, width, height)
  // Monospace, because a column of prices that does not line up is a column of
  // prices you have to read one at a time.
  g.font = `${FONT_SIZE}px ui-monospace, monospace`
  g.textBaseline = 'top'

  if (!shown.open) {
    if (shown.notice) note(g, shown.notice, 28, height / 2)
    return
  }

  const panelHeight = PADDING * 2 + LINE_HEIGHT * (shown.rows.length + 2)
  const left = 28
  const top = Math.max(28, (height - panelHeight) / 2)

  g.fillStyle = COLOURS.panel
  g.fillRect(left, top, PANEL_WIDTH, panelHeight)
  g.strokeStyle = COLOURS.edge
  g.lineWidth = 1
  g.strokeRect(left + 0.5, top + 0.5, PANEL_WIDTH - 1, panelHeight - 1)

  const textLeft = left + PADDING
  const textRight = left + PANEL_WIDTH - PADDING
  let y = top + PADDING

  g.fillStyle = COLOURS.heading
  g.textAlign = 'left'
  g.fillText(shown.heading, textLeft, y)
  g.fillStyle = COLOURS.money
  g.textAlign = 'right'
  g.fillText(`$${shown.money}`, textRight, y)
  y += LINE_HEIGHT

  for (const row of shown.rows) {
    // Greyed rather than hidden: what you cannot afford yet is information.
    g.fillStyle = row.affordable ? COLOURS.line : COLOURS.spent
    g.textAlign = 'left'
    g.fillText(`${row.number}. ${row.name}`, textLeft, y)
    if (row.price != null) {
      g.textAlign = 'right'
      g.fillText(`$${row.price}`, textRight, y)
    }
    y += LINE_HEIGHT
  }

  g.fillStyle = COLOURS.spent
  g.textAlign = 'left'
  g.fillText('backspace — back', textLeft, y)

  if (shown.notice) note(g, shown.notice, left, top + panelHeight + LINE_HEIGHT)
}

/** A refusal, said where the player is looking and not only on the console. */
function note(g, text, x, y) {
  g.textAlign = 'left'
  g.fillStyle = COLOURS.heading
  g.fillText(text, x, y)
}
