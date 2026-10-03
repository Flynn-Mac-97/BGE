/** Synthetic threat probes distinguish burst, sustain and armour; these are not campaign win rates. */
import { rules } from '../plugins/bell/rules.js';
import { costs } from '../plugins/npc-lab/definitions.js';
export const layouts={weapons:[['dagger',0,0],['dagger',1,0],['dagger',2,0]],hammer:[['hammer',0,0],['dagger',1,0],['dagger',2,0]],storm:[['dagger',0,0],['stormTotem',1,0],['dagger',2,0]],growth:[['dagger',0,0],['rootTotem',1,0],['dagger',2,0]],curse:[['curseIdol',0,0],['dagger',1,0],['reapingSeal',2,0]],salvage:[['salvagePack',3,0],['dagger',3,0],['patchKit',2,0]]};
export function supportMatrix() {
const results=[];
for(const [name,placed] of Object.entries(layouts))for(const threat of [{name:'burst',health:12,damage:8,guard:0},{name:'attrition',health:24,damage:3,guard:0},{name:'armour',health:18,damage:2,guard:2},{name:'heavyArmour',health:18,damage:2,guard:4}]){
const state=rules.createState({actors:{recruit:{team:'crew',maxHealth:12,resources:{salvage:0},resourceCaps:{salvage:99}},enemy:{team:'enemy',maxHealth:threat.health,stats:{damage:threat.damage},abilities:[...(threat.guard?[{id:'guard',trigger:{event:'cycleStart'},target:{kind:'self'},effects:[{type:'guard',amount:threat.guard}]}]:[]),{id:'attack',trigger:{event:'ownTurn'},target:{kind:'enemy'},effects:[{type:'damage',amount:{stat:'damage'}}]}]}},items:placed.map(([type,x,y],i)=>({id:'item-'+i,type,owner:'recruit',position:[x,y]}))});
let battle=state,cycles=0;while(!rules.winner(battle)&&cycles<30){battle=rules.resolveCycle(battle,{afterCycle:['enemy'],trace:'none'}).state;cycles++;}
results.push({name,cost:placed.reduce((sum,[type])=>sum+costs[type],0),threat:threat.name,winner:rules.winner(battle),health:battle.actors.recruit.health,cycles});
}
return results;
}
