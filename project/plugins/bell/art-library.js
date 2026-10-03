/** Stable placeholder IDs and browse groups do not define gameplay items or actor rules. */
const groups = {
  item: [
    ['Weapons', ['shortSword', 'curvedSword', 'greatSword', 'handAxe', 'battleAxe', 'warPick', 'woodenClub', 'spikedMace']],
    ['Weapons', ['spear', 'halberd', 'huntingBow', 'crossbow', 'quiver', 'throwingKnife', 'sling', 'flail']],
    ['Armour', ['kiteShield', 'towerShield', 'ironHelm', 'leatherCap', 'chainShirt', 'plateGlove', 'ironBoots', 'travelCloak']],
    ['Nature', ['oakLeaf', 'thornVine', 'mushroom', 'rootBundle', 'seedPod', 'antlerCharm', 'honeycomb', 'feather']],
    ['Alchemy', ['roundPotion', 'tallPotion', 'doubleFlask', 'mortarPestle', 'powderBomb', 'coilBattery', 'crystalShard', 'hourglass']],
    ['Relics', ['waxCandle', 'ritualSkull', 'boundBook', 'boneWand', 'moonAmulet', 'signetRing', 'runeTablet', 'scryingEye']],
    ['Supplies', ['breadLoaf', 'cheeseWedge', 'meatJoint', 'waterSkin', 'coinPurse', 'woodenChest', 'travelSatchel', 'bedroll']],
    ['Tools', ['ropeCoil', 'ironKey', 'lockpicks', 'oilLantern', 'handShovel', 'pickaxe', 'sewingKit', 'scrollRoll']],
  ],
  portrait: [
    ['Adventurers', ['scarredSwordsman', 'spearGuard', 'womanKnight', 'beardedAxeman', 'hoodedArcher', 'womanRanger', 'youngSquire', 'oldVeteran']],
    ['Adventurers', ['staffWizard', 'womanMage', 'herbWitch', 'antlerDruid', 'wanderingMonk', 'armouredCleric', 'maskedRogue', 'duelist']],
    ['Townsfolk', ['baldSmith', 'womanSmith', 'apronCook', 'sternInnkeeper', 'oldFarmer', 'youngFarmer', 'hoodedShepherd', 'sailor']],
    ['Townsfolk', ['coinMerchant', 'womanTrader', 'spectacledScribe', 'tiredScholar', 'plagueDoctor', 'bandagedHealer', 'lanternKeeper', 'travellingBard']],
    ['Outcasts', ['raggedBeggar', 'oneEyedThief', 'raggedScavenger', 'packPorter', 'grinningGambler', 'veiledStranger', 'prisoner', 'graveDigger']],
    ['Occultists', ['vampireNoble', 'womanVampire', 'bonePriest', 'blindOracle', 'ashCultist', 'hornedWarlock', 'mushroomHermit', 'maskedAlchemist']],
    ['Creatures', ['goblinSneak', 'goblinBrute', 'orcRaider', 'ogre', 'troll', 'skeletalSoldier', 'zombie', 'wraith']],
    ['Creatures', ['wolf', 'raven', 'giantBat', 'giantSpider', 'boar', 'packYak', 'serpent', 'ratFolk']],
  ],
}

/** Human labels are separate from the IDs stored in saved concepts. */
export const artLabel = id => id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())

/** Additional images share the same flat record as the original art library. */
export const extraArt = Object.entries(groups).flatMap(([kind, rows]) => rows.flatMap(([category, ids]) => ids.map(id => ({ id, kind, category, label: artLabel(id) }))))
