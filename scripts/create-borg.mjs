import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateTheme } from '../src/shared/theme.mjs';
import { syncDockHomes } from '../src/shared/docking.mjs';
const dir = fileURLToPath(new URL('../themes/borg/', import.meta.url));
const assets = {};
async function sheet(file, columns, rows, ids, height, fixed = false) {
  const bytes = await readFile(path.join(dir, 'assets', file)), width = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
  ids.forEach((id, i) => {
    const x = i % columns, y = Math.floor(i / columns), left = Math.round(x * width / columns), top = Math.round(y * h / rows);
    assets[id] = { file: `assets/${file}`, rect: [left, top, Math.round((x + 1) * width / columns) - left, Math.round((y + 1) * h / rows) - top], height, ...(fixed ? { trim: false, anchor: [.5, .95] } : {}) };
  });
}
const frameNames = ['idle', 'walk-left', 'walk-right', 'back-left', 'back-right', 'work-a', 'work-b', 'dock', 'regenerate'];
for (let n = 1; n <= 8; n++) { const id = `drone-${String(n).padStart(2, '0')}`; await sheet(`${id}.png`, 3, 3, frameNames.map(p => `${id}-${p}`), n === 6 ? 105 : n === 7 ? 88 : 96, true); }
await sheet('queen.png', 4, 3, Array.from({ length: 12 }, (_, i) => `queen-${i}`), 144, true);
await sheet('workstations.png', 4, 2, ['nexus', 'data-console', 'repair-bench', 'tactical-console', 'transwarp-coil', 'neural-relay', 'diagnostic', 'fabricator'], 110);
assets.nexus.anchor = [.5, .75];
await sheet('structure-v2.png', 4, 2, ['hull-wall', 'corner-pillar', 'railing', 'power-conduit', 'plasma-reactor', 'vent-block', 'cargo', 'queen-gantry'], 130);
await sheet('terrain.png', 2, 2, ['mesh', 'walkway', 'conduit', 'nexus-floor'], 24);
assets.alcove = { file: 'assets/alcove-v2.png', height: 166, anchor: [.46, .88] };
const green = { color: '#8aff56', speed: 1, when: 'always', nodes: [[.5, .3, .025]], bars: [] };
const objects = {
  alcove: { asset: 'alcove', footprint: [-1, -1, 3, 1], dock: { approach: [0, 2], entry: [0, 0], turnSeconds: .5, enterSeconds: 2.4, exitSeconds: 1.4, enterPose: 'dock', restPose: 'regenerate' }, lights: { color: '#8bff5a', when: 'occupied', speed: 1.2, nodes: [[.48, .245, .067]], bars: [{ from: [.10, .40], to: [.10, .64], width: .011 }, { from: [.77, .40], to: [.77, .65], width: .011 }], scan: { from: [.45, .34], to: [.45, .84], width: .36 } } },
  nexus: { asset: 'nexus', walkable: true, lights: { ...green, nodes: [[.5, .69, .08]], speed: .7 } },
  'data-console': { asset: 'data-console', footprint: [-1, -1, 3, 2], lights: { ...green, nodes: [[.25, .40, .025], [.5, .32, .025], [.76, .25, .025]] } },
  'repair-bench': { asset: 'repair-bench', footprint: [-1, -1, 3, 2] },
  'tactical-console': { asset: 'tactical-console', footprint: [-1, -1, 3, 2], lights: { ...green, nodes: [[.5, .24, .07]], speed: .65 } },
  'transwarp-coil': { asset: 'transwarp-coil', footprint: [-1, -1, 3, 2], lights: { ...green, nodes: [[.5, .35, .09], [.5, .57, .09]], speed: .55 } },
  'neural-relay': { asset: 'neural-relay', footprint: [-1, -1, 3, 2], lights: { ...green, nodes: [[.3, .5, .015], [.5, .45, .015], [.7, .4, .015]] } },
  diagnostic: { asset: 'diagnostic', footprint: [-1, -1, 3, 2], lights: { ...green, nodes: [[.55, .25, .035]] } },
  fabricator: { asset: 'fabricator', footprint: [-1, -1, 3, 2], lights: { ...green, nodes: [[.28, .35, .025], [.5, .3, .025], [.7, .25, .025]] } },
  'hull-wall': { asset: 'hull-wall', footprint: [-1, 0, 3, 1] },
  'corner-pillar': { asset: 'corner-pillar', footprint: [0, 0, 1, 1] },
  railing: { asset: 'railing', footprint: [-1, 0, 3, 1] },
  'power-conduit': { asset: 'power-conduit', footprint: [0, 0, 1, 1], lights: { ...green, nodes: [[.5, .2, .02]] } },
  'plasma-reactor': { asset: 'plasma-reactor', footprint: [-1, -1, 3, 2], lights: { ...green, nodes: [[.5, .5, .08]], speed: .6 } },
  'vent-block': { asset: 'vent-block', footprint: [0, 0, 2, 1] },
  cargo: { asset: 'cargo', footprint: [0, 0, 1, 1] },
  'queen-gantry': { asset: 'queen-gantry', footprint: [-1, -1, 3, 1], lights: { ...green, nodes: [[.5, .22, .07]], speed: .8 } }
};
const terrain = Array.from({ length: 36 }, (_, v) => Array.from({ length: 36 }, (_, u) => u <= 1 || v <= 1 || u >= 34 || v >= 34 ? 'conduit' : Math.abs(u - 18) <= 1 || Math.abs(v - 18) <= 1 || v === 8 || v === 32 || u === 8 || u === 29 ? 'walkway' : 'mesh'));
for (let v = 15; v <= 21; v++) for (let u = 15; u <= 21; u++) terrain[v][u] = 'nexus-floor';
const placed = [], place = (id, kind, tile, height, mirror = false) => placed.push({ id, kind, tile, height, ...(mirror ? { mirror } : {}) });
const alcoves = [[5,5],[10,5],[15,5],[20,5],[5,14],[5,19],[5,24],[5,29],[26,5],[31,5],[12,29],[17,29],[22,29],[27,29],[31,15],[31,23]];
alcoves.forEach((tile, i) => place(`alcove-${i + 1}`, 'alcove', tile, 166));
place('queen-nexus', 'nexus', [18,18], 205);
place('queen-gantry', 'queen-gantry', [16,16], 215);
for (const [id, kind, tile, height] of [
  ['data', 'data-console', [12,12], 100], ['repair', 'repair-bench', [12,23], 110], ['tactical', 'tactical-console', [24,12], 125],
  ['transwarp', 'transwarp-coil', [27,9], 145], ['relay', 'neural-relay', [12,18], 115], ['medical', 'diagnostic', [25,19], 115],
  ['fabrication', 'fabricator', [24,25], 105], ['reactor-a', 'plasma-reactor', [9,9], 135], ['reactor-b', 'plasma-reactor', [29,29], 125]
]) place(id, kind, tile, height);
for (let n = 4; n <= 34; n += 5) {
  place(`wall-back-${n}`, 'hull-wall', [n,1], 140);
  place(`wall-side-${n}`, 'hull-wall', [1,n], 140, true);
  place(`rail-front-${n}`, 'railing', [n,35], 48);
  place(`rail-side-${n}`, 'railing', [35,n], 48, true);
}
for (const tile of [[1,1],[34,1],[1,34],[34,34]]) place(`pillar-${tile.join('-')}`, 'corner-pillar', tile, 180);
for (const tile of [[8,3],[23,3],[3,10],[3,22],[33,10],[33,28],[10,33],[25,33]]) place(`conduit-${tile.join('-')}`, 'power-conduit', tile, 135);
for (const tile of [[9,26],[28,14],[22,8],[8,16]]) place(`vent-${tile.join('-')}`, 'vent-block', tile, 55);
for (const tile of [[9,21],[10,21],[28,23],[29,23]]) place(`cargo-${tile.join('-')}`, 'cargo', tile, 45);
const activities = {
  regenerate: { label: 'Regenerating in an alcove', pose: 'regenerate', motion: 'home', fps: 1, duration: 120 },
  process: { label: 'Processing collective data', pose: 'work', motion: 'visit', targets: [[12,14]], fps: 1.5, duration: 20 },
  repair: { label: 'Repairing cube systems', pose: 'work', motion: 'visit', targets: [[12,25]], fps: 2, duration: 20 },
  tactical: { label: 'Analyzing tactical telemetry', pose: 'work', motion: 'visit', targets: [[24,14]], fps: 1.4, duration: 20 },
  transwarp: { label: 'Calibrating the transwarp coil', pose: 'work', motion: 'visit', targets: [[27,11]], fps: 1.4, duration: 20 },
  relay: { label: 'Synchronizing the neural network', pose: 'work', motion: 'visit', targets: [[12,20]], fps: 1.7, duration: 20 },
  diagnostic: { label: 'Running cybernetic diagnostics', pose: 'work', motion: 'visit', targets: [[25,21]], fps: 1.5, duration: 20 },
  fabricate: { label: 'Fabricating components', pose: 'work', motion: 'visit', targets: [[24,27]], fps: 2, duration: 20 },
  'queen-command': { label: 'Directing the collective', pose: 'command', motion: 'visit', targets: [[18,18]], fps: 1.4, duration: 18 },
  'queen-scan': { label: 'Surveying the cube', pose: 'scan', motion: 'visit', targets: [[18,18]], fps: .8, duration: 16 },
  'queen-commune': { label: 'Communing with the collective', pose: 'commune', motion: 'visit', targets: [[18,18]], fps: 1.2, duration: 18 },
  'queen-assemble': { label: 'Reassembling at the central nexus', pose: 'assemble', motion: 'visit', targets: [[18,18]], fps: .85, duration: 16 }
};
const queen = { id: 'queen', name: 'Borg Queen', home: [18,18], poses: { idle:'queen-0', walk:['queen-0','queen-3'], work:['queen-1','queen-2','queen-3','queen-0'], dock:['queen-0'], regenerate:'queen-11', command:['queen-0','queen-1','queen-2','queen-3'], scan:['queen-0','queen-4','queen-0','queen-5'], commune:['queen-0','queen-6','queen-7','queen-6'], assemble:['queen-8','queen-9','queen-10','queen-11','queen-10','queen-9'] }, idleActivities: ['queen-scan','queen-commune','queen-assemble'] };
const names = ['One of Eight','Two of Eight','Three of Eight','Four of Eight','Five of Eight','Six of Eight','Seven of Eight','Eight of Eight'];
const special = ['tactical','repair','process','diagnostic','relay','fabricate','repair','transwarp'];
const drones = names.map((name, i) => {
  const id = `drone-${String(i + 1).padStart(2,'0')}`, a = p => `${id}-${p}`, work = [a('work-a'), a('work-b')];
  return { id, name, home: [alcoves[i][0], alcoves[i][1] + 2], homeDock: `alcove-${i + 1}`, inactiveActivity: 'regenerate', idleActivities: ['regenerate'], bindings: { default:special[i], working:special[i] }, poses: { idle:a('idle'), walk:[a('walk-left'),a('walk-right')], 'walk-back':[a('back-left'),a('back-right')], work, dock:[a('dock'),a('walk-right'),a('dock'),a('walk-left')], regenerate:a('regenerate'), command:work, scan:work, commune:work, assemble:work } };
});
const queenRules = { default:'queen-command', coordinate:'queen-command', delegate:'queen-command', research:'queen-scan', read:'queen-scan', review:'queen-scan', message:'queen-commune', tool:'queen-commune', build:'queen-assemble', waiting:'queen-commune', interrupted:'queen-scan', completed:'queen-assemble' };
const t = { schemaVersion:1, id:'borg', name:'Borg Cube', version:'1.0.0', author:'William Pyle', description:'A Borg cube built around its Queen. Eight distinct drones work the collective systems, back into regeneration alcoves when inactive, and recharge under animated green lights. Requires Agent Watch 0.4.0 or later.', preview:'assets/logo.svg', logo:'assets/logo.svg', palette:{background:'#080e0b',panel:'#101b15',surface:'#19291e',text:'#e7f4e2',muted:'#9bb695',accent:'#94e85b',border:'#344e35',world:'#07100a',label:'#102315'}, assets, terrain:{mesh:{asset:'mesh',walkable:true},walkway:{asset:'walkway',walkable:true},conduit:{asset:'conduit',walkable:false},'nexus-floor':{asset:'nexus-floor',walkable:true}},objects, scene:{world:{width:1900,height:1260,columns:36,rows:36,tileWidth:48,tileHeight:24,originX:950,originY:220},terrain,objects:placed},characters:[queen,...drones],roleCharacters:{coordinator:'queen'},fallbackCharacter:'drone-01',activities,idleActivities:['regenerate'],bindings:{default:'process',started:'process',build:'repair',read:'process',research:'tactical',review:'diagnostic',delegate:'relay',message:'relay',coordinate:'relay',tool:'fabricate',wait:'regenerate',waiting:'regenerate',quiet:'regenerate',idle:'regenerate',unknown:'regenerate',completed:'regenerate',interrupted:'regenerate',update:'relay'},roleBindings:{coordinator:queenRules} };
try { const old = JSON.parse(await readFile(path.join(dir,'theme.json'),'utf8')); if (old.preview.endsWith('.png')) t.preview = old.preview; } catch {}
syncDockHomes(t); validateTheme(t);
await writeFile(path.join(dir,'theme.json'),JSON.stringify(t,null,2)+'\n');
await writeFile(path.join(dir,'assets/logo.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect x="12" y="12" width="104" height="104" rx="12" fill="#14291a" stroke="#91e659" stroke-width="4"/><path d="M32 32h64v64H32zM48 12v20m32-20v20M12 48h20m-20 32h20m64-32h20M96 80h20M48 96v20m32-20v20" fill="none" stroke="#4b7f43" stroke-width="5"/><circle cx="64" cy="64" r="20" fill="#2c5329" stroke="#a4ff65" stroke-width="5"/><circle cx="64" cy="64" r="6" fill="#e0ffc7"/></svg>\n');
console.log(`Created Borg Cube: ${t.characters.length} characters, ${placed.length} placed objects, ${alcoves.length} regeneration alcoves.`);
