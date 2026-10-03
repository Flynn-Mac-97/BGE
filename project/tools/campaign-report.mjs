/** Earn and settle complete expeditions using production rules; fixed policies make balance changes comparable. */
import { supportMatrix } from './balance-bench.mjs'
import { seededRandom } from '../plugins/npc-lab/combo-space.js'
import { writeFile } from 'node:fs/promises'
import { rules } from '../plugins/bell/rules.js'
import { createCompany, hire, embark, returnToTavern, learn, refine } from '../plugins/bell/campaign.js'
import { finishBattle, descend, claim } from '../plugins/bell/loop.js'
function equipFind(journey,type){
 const id='item-'+journey.nextItem;
 if(!claim(journey,type))throw Error('claim');
 const item=journey.battle.items[id];
 if(rules.catalog.items[type].storage){rules.place(journey.battle,id,[journey.battle.grid.columns,0]);return;}
 for(let y=0;y<3;y++)for(let x=0;x<journey.battle.grid.columns;x++)if(rules.place(journey.battle,id,[x,y]))return;
}
function run(company,id,stop,loot,random=seededRandom(13)){
 const journey=embark(company,id);if(!journey)throw Error('embark '+id);
 const rooms=[];
 while(journey.phase==='battle'){
  let cycles=0;
  while(journey.phase==='battle'&&cycles<31){journey.battle=rules.resolveCycle(journey.battle,{afterCycle:['enemy']}).state;finishBattle(journey,random);cycles++;}
  rooms.push({room:journey.room,cycles,health:journey.battle.actors.recruit.health,outcome:journey.phase});
  if(journey.phase==='defeat')break;
  if(journey.rewardKind==='room')equipFind(journey,journey.choices.includes(loot)?loot:journey.choices.at(-1));
  else if(journey.room<stop)descend(journey);
  if(journey.cleared>=stop||journey.phase==='expeditionComplete')break;
 }
 const outcome=journey.phase;
 if(!returnToTavern(company,journey))throw Error('settlement');
 return {rooms,outcome,cleared:journey.cleared,coin:company.coins,kit:structuredClone(company.roster[id].kit)};
}
const unlock=createCompany();hire(unlock,'rook');run(unlock,'rook',4,'venom');learn(unlock,'rook','brace');refine(unlock,'rook','item-1');const unlockRun=run(unlock,'rook',8,'venom');
const progression=[];
for(const seed of [1,7,31,101,997])for(const id of ['rook','nettle','pip','toll','moss'])for(const loot of ['venom','stormTotem','salve'])for(const trait of [null,'brace','mend'])for(const upgraded of [false,true]){
 const random=seededRandom(seed);
 const company=['toll','moss'].includes(id)?structuredClone(unlock):createCompany();
 if(!hire(company,id))throw Error('hire '+id);
 const first=run(company,id,4,loot,random);
 if(first.outcome==='defeat'){progression.push({seed,id,loot,trait,upgraded,first});continue;}
 if(trait&&!learn(company,id,trait))throw Error('learn');
 const weapon=company.roster[id].kit.find(item=>item.type==='dagger');
 if(upgraded&&!refine(company,id,weapon.id))throw Error('refine');
 const second=run(company,id,8,loot,random);
 progression.push({seed,id,loot,trait,upgraded,first,second});
}
const firstExpeditions=[];
for(const id of ['rook','nettle','pip'])for(const loot of ['venom','stormTotem','salve']){const company=createCompany();hire(company,id);firstExpeditions.push({id,loot,...run(company,id,8,loot)});}
const report = { support: supportMatrix(), firstExpeditions, version: 1, seeds: [1,7,31,101,997], policy: 'Earn first four rooms, first-fit loot placement, bank, optional trait/refinement, then eight rooms. Recruits Toll/Moss funded by actual Rook clear. No injected progression.', unlockRun, progression };
report.summary = { paths: progression.length, firstExpeditionClears: firstExpeditions.filter(run => run.cleared === 8).length, firstFourWins: progression.filter(run => run.first.cleared === 4).length, refinedWins: progression.filter(run => run.upgraded && run.second?.cleared === 8).length, unrefinedWins: progression.filter(run => !run.upgraded && run.second?.cleared === 8).length, timeouts: progression.filter(run => run.second?.rooms.at(-1).cycles === 30).length };
await writeFile(process.argv[2] ?? 'campaign-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
