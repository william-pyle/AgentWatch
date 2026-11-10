import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateTheme } from '../src/shared/theme.mjs';
const dir = fileURLToPath(new URL('../themes/smurfs/', import.meta.url));
await mkdir(path.join(dir, 'assets'), { recursive: true });
const assets = {}, names = ['papa', 'smurfette', 'brainy', 'jokey', 'hefty', 'smurf'];
async function atlas(file, columns, rows, cells) {
  const bytes = await readFile(path.join(dir, 'assets', `${file}.png`)), width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  for (const [i, [id, h]] of cells.entries()) { const x = Math.round((i % columns) * width / columns), y = Math.round(Math.floor(i / columns) * height / rows); assets[id] = { file: `assets/${file}.png`, rect: [x, y, Math.round((i % columns + 1) * width / columns) - x, Math.round((Math.floor(i / columns) + 1) * height / rows) - y], height: h }; }
}
for (const id of names) await atlas(id, 3, 2, ['idle', 'walk-left', 'walk-right', 'work-a', 'work-b', 'greet'].map(pose => [`${id}-${pose}`, id === 'smurfette' ? 69 : 66]));
const houses = ['papa-house', 'smurfette-house', 'brainy-house', 'jokey-house', 'hefty-house', 'smurf-house', 'bakery', 'workshop'];
await atlas('homes', 4, 2, houses.map(id => [id, id === 'papa-house' ? 158 : 140]));
await atlas('woodland', 4, 2, [['oak', 185], ['forest-tree', 178], ['berry-bush', 40], ['well', 94], ['bridge', 75], ['toadstools', 37], ['fallen-log', 49], ['river-rocks', 40]]);
await atlas('workplaces', 4, 2, [['alchemy', 68], ['reading-desk', 84], ['workbench', 66], ['festival-stage', 110], ['berry-cart', 60], ['training', 62], ['bench', 45], ['flower-garden', 35]]);
await atlas('terrain', 2, 2, ['grass', 'path', 'cobble', 'water'].map(k => [k, 22]));
await writeFile(path.join(dir, 'assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="25" fill="#173f4e"/><path d="M20 59Q8 47 27 32q3-19 25-17 31 1 32 26-3 18-20 20" fill="#f7f7ed" stroke="#193448" stroke-width="4"/><ellipse cx="50" cy="66" rx="29" ry="22" fill="#37b8f0" stroke="#193448" stroke-width="4"/><ellipse cx="63" cy="61" rx="13" ry="9" fill="#37b8f0"/><ellipse cx="42" cy="56" rx="6" ry="9" fill="#fff"/><circle cx="44" cy="58" r="3" fill="#193448"/><path d="M36 72q10 11 23 0" fill="none" stroke="#193448" stroke-width="3" stroke-linecap="round"/></svg>');
const objects = {};
for (const id of houses) objects[id] = { asset: id, footprint: [-2, -2, 4, 3] };
for (const [id, anchor] of [['papa-house', [.258, .035]], ['smurf-house', [.24, .047]], ['bakery', [.23, .04]]]) objects[id].smoke = { anchor, color: '#e8e9da', scale: .75, speed: .8 };
for (const id of ['oak', 'forest-tree', 'berry-bush', 'toadstools', 'fallen-log', 'river-rocks', 'well', 'alchemy', 'reading-desk', 'workbench', 'festival-stage', 'berry-cart', 'training', 'bench', 'flower-garden']) objects[id] = { asset: id, footprint: ['oak', 'forest-tree', 'toadstools', 'berry-bush'].includes(id) ? [0, 0, 1, 1] : [-1, -1, 3, 2] };
objects['flower-garden'].ground = true;
objects.bridge = { asset: 'bridge', walkable: true, deck: { start: [.17, .32], end: [.80, .86] } };
const world = { width: 1500, height: 1060, columns: 32, rows: 32, tileWidth: 44, tileHeight: 22, originX: 750, originY: 180 };
const terrain = Array.from({ length: 32 }, (_, v) => Array.from({ length: 32 }, (_, u) => u >= 22 && u <= 24 ? 'water' : [9, 17, 25].includes(v) || [8, 17, 28].includes(u) ? 'path' : 'grass'));
for (let v = 13; v <= 19; v++) for (let u = 9; u <= 15; u++) if ((u - 12) ** 2 + (v - 16) ** 2 < 12) terrain[v][u] = 'cobble';
for (const v of [12, 24]) for (let u = 17; u < 30; u++) if (u < 22 || u > 24) terrain[v][u] = 'path';
const placed = [], add = (id, kind, tile, height = assets[kind].height, extra = {}) => placed.push({ id, kind, tile, height, ...extra });
const homeTiles = { papa: [7, 5], smurfette: [4, 13], brainy: [14, 5], jokey: [8, 22], hefty: [17, 22], smurf: [5, 27] };
for (const id of names) add(`home-${id}`, `${id}-house`, homeTiles[id]);
add('village-bakery', 'bakery', [14, 12]); add('handy-workshop', 'workshop', [18, 7]);
add('east-bank-home', 'smurf-house', [28, 7], 135); add('orchard-home', 'smurf-house', [29, 21], 128, { mirror: true });
add('papa-alchemy-bench', 'alchemy', [8, 8]); add('brainy-reading-desk', 'reading-desk', [14, 8]);
add('handy-workbench', 'workbench', [18, 10]); add('village-well', 'well', [11, 16]);
add('festival-stage', 'festival-stage', [17, 16]); add('harvest-cart', 'berry-cart', [27, 15]);
add('hefty-training', 'training', [18, 25]); add('well-bench', 'bench', [10, 19]);
add('garden-bench', 'bench', [5, 18]); add('reading-bench', 'bench', [10, 11]);
add('smurfette-flowers', 'flower-garden', [4, 16]); add('smurfette-flowers-east', 'flower-garden', [6, 15]);
add('north-bridge', 'bridge', [22, 12], 75, { axis: 'u', length: 3 }); add('south-bridge', 'bridge', [22, 24], 75, { axis: 'u', length: 3 });
for (const [i, tile] of [[26, 10], [29, 10], [26, 12], [29, 13], [26, 18], [29, 18], [26, 27], [29, 27], [20, 27], [2, 19]].entries()) add(`smurfberries-${i}`, 'berry-bush', tile);
for (const [i, tile] of [[3, 4], [10, 3], [20, 4], [2, 10], [2, 23], [11, 27], [20, 19], [27, 3], [30, 25]].entries()) add(`toadstools-${i}`, 'toadstools', tile);
add('forest-log', 'fallen-log', [3, 7]); add('berry-log', 'fallen-log', [27, 29]);
for (const [i, tile] of [[21, 4], [25, 8], [21, 19], [25, 22], [21, 29]].entries()) add(`stream-rocks-${i}`, 'river-rocks', tile);
// Tall trees stay mostly behind the village; the foreground remains easy to read and edit.
let tree = 0;
for (let n = 1; n < 32; n += 3) for (const tile of [[n, 1], [1, n]]) if (tile[0] < 22 || tile[0] > 24) add(`forest-${tree}`, tree++ % 2 ? 'forest-tree' : 'oak', tile, 150 + tree % 4 * 13);
for (const tile of [[30, 3], [31, 11], [31, 16], [31, 29], [16, 30], [7, 31], [20, 1], [30, 31]]) add(`forest-${tree}`, tree++ % 2 ? 'forest-tree' : 'oak', tile, 130 + tree % 3 * 12);
const activity = (label, pose, motion, duration, targets, fps = 1.3) => ({ label, pose, motion, duration, fps, ...(targets ? { targets } : {}) });
const activities = {
  council: activity('Coordinating at Papa’s alchemy bench', 'work', 'visit', 24, [[8, 9]]),
  potions: activity('Studying a potion with Papa', 'work', 'visit', 18, [[8, 9]]),
  read: activity('Reading in the village library', 'read', 'visit', 20, [[14, 9]]),
  craft: activity('Helping at Handy’s workshop', 'work', 'visit', 18, [[18, 11]]),
  garden: activity('Tending Smurfette’s flowers', 'garden', 'visit', 20, [[3, 16], [6, 16]]),
  berries: activity('Gathering smurfberries', 'gather', 'visit', 18, [[26, 11], [29, 14], [26, 19], [29, 28]]),
  train: activity('Keeping strong with Hefty', 'work', 'visit', 16, [[18, 26]]),
  surprise: activity('Sharing one of Jokey’s surprises', 'work', 'visit', 12, [[17, 17]]),
  bakery: activity('Visiting the village bakery', 'idle', 'visit', 12, [[14, 13]]),
  well: activity('Meeting by the village well', 'idle', 'visit', 14, [[11, 17], [12, 18]]),
  rest: activity('Taking a quiet woodland break', 'idle', 'visit', 16, [[10, 20], [5, 19]]),
  home: activity('Resting at the mushroom house', 'idle', 'home', 22),
  stroll: activity('Exploring the Smurf forest', 'idle', 'wander', 20),
  celebrate: activity('Celebrating a finished turn', 'greet', 'stay', 8, undefined, 1),
  wait: activity('Waiting for your answer', 'idle', 'stay', 8)
};
const characterNames = { papa: 'Papa Smurf', smurfette: 'Smurfette', brainy: 'Brainy Smurf', jokey: 'Jokey Smurf', hefty: 'Hefty Smurf', smurf: 'Smurf' };
const characters = names.map(id => ({ id, name: characterNames[id], home: [homeTiles[id][0], homeTiles[id][1] + 1], poses: {
  idle: `${id}-idle`, walk: [`${id}-walk-left`, `${id}-idle`, `${id}-walk-right`, `${id}-idle`], work: [`${id}-work-a`, `${id}-work-b`], greet: [`${id}-greet`, `${id}-idle`],
  read: id === 'brainy' ? [`${id}-work-a`, `${id}-work-b`] : `${id}-idle`, garden: id === 'smurfette' ? [`${id}-work-a`, `${id}-work-b`] : `${id}-idle`, gather: id === 'smurf' ? [`${id}-work-a`, `${id}-work-b`] : `${id}-idle`
} }));
Object.assign(characters[0], { idleActivities: ['potions', 'well', 'home'] });
Object.assign(characters[1], { idleActivities: ['garden', 'well', 'home', 'stroll'], bindings: { build: 'garden', tool: 'garden', review: 'garden' } });
Object.assign(characters[2], { idleActivities: ['read', 'well', 'home'], bindings: { build: 'read', tool: 'read', research: 'read', review: 'read' } });
Object.assign(characters[3], { idleActivities: ['surprise', 'stroll', 'home'], bindings: { message: 'surprise', tool: 'surprise' } });
Object.assign(characters[4], { idleActivities: ['train', 'bakery', 'home'], bindings: { review: 'train', tool: 'train' } });
Object.assign(characters[5], { idleActivities: ['berries', 'rest', 'home', 'stroll'] });
const preview = await access(path.join(dir, 'assets/preview.png')).then(() => 'assets/preview.png').catch(() => 'assets/logo.svg');
const theme = { schemaVersion: 1, id: 'smurfs', name: 'Smurfs', version: '1.0.0', author: 'William Pyle',
  description: 'A cheerful Smurf village with Papa coordinating, Smurfette, Brainy, Jokey, Hefty and reusable Smurfs. Mushroom homes, smurfberries, a well, woodland work areas and a flowing stream.',
  preview, logo: 'assets/logo.svg', palette: { background: '#112e36', panel: '#193e47', surface: '#24505a', text: '#fff8df', muted: '#b7cbbf', accent: '#ffd275', border: '#3e6870', world: '#365f46', label: '#173e48' },
  assets, terrain: { grass: { asset: 'grass', walkable: true }, path: { asset: 'path', walkable: true }, cobble: { asset: 'cobble', walkable: true }, water: { asset: 'water', walkable: false, flow: { color: '#d7ffff', speed: .8, direction: [0, 1] } } }, objects,
  scene: { world, terrain, objects: placed }, characters, roleCharacters: { coordinator: 'papa' }, fallbackCharacter: 'smurf', activities,
  idleActivities: ['berries', 'rest', 'home', 'stroll'],
  bindings: { default: 'craft', started: 'well', build: 'craft', read: 'read', research: 'read', review: 'read', delegate: 'council', coordinate: 'council', message: 'well', tool: 'berries', completed: 'celebrate', wait: 'wait', waiting: 'wait', interrupted: 'wait', 'tool:print': 'read' },
  roleBindings: { coordinator: Object.fromEntries(['default', 'started', 'build', 'read', 'research', 'review', 'delegate', 'coordinate', 'message', 'tool', 'working'].map(k => [k, 'council'])) }
};
validateTheme(theme);
await writeFile(path.join(dir, 'theme.json'), JSON.stringify(theme, null, 2) + '\n');
console.log(`Created Smurfs: ${characters.length} character types, ${Object.keys(objects).length} scenery types, ${placed.length} placed objects, ${Object.keys(activities).length} activities.`);
