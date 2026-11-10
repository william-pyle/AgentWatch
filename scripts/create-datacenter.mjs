import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = fileURLToPath(new URL('../themes/datacenter/', import.meta.url));
await mkdir(path.join(dir, 'assets'), { recursive: true });
const saveSvg = (name, body, box = '0 0 100 50') => writeFile(path.join(dir, `assets/${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>`);
await saveSvg('floor', '<path d="M50 1 99 25 50 49 1 25z" fill="#b9c9ce" stroke="#7f969f" stroke-width="1.5"/><path d="m8 25 42 20 42-20-42-20z" fill="#c8d4d7"/><circle cx="50" cy="5" r="1" fill="#7b949e"/>');
await saveSvg('aisle', '<path d="M50 1 99 25 50 49 1 25z" fill="#718f9b" stroke="#53727f"/><path d="m5 25 45 22 45-22-45-22z" fill="none" stroke="#99cbd1" stroke-width="1"/>');
await saveSvg('vent', '<path d="M50 1 99 25 50 49 1 25z" fill="#94aeb7" stroke="#69818c"/><path d="m18 22 40 20m-32-24 40 20m-32-24 40 20m-32-24 40 20" stroke="#627d8a" stroke-width="3"/>');
await saveSvg('logo', '<rect width="100" height="100" rx="26" fill="#203640"/><path d="M50 28V14" stroke="#8cd9d4" stroke-width="5"/><circle cx="50" cy="12" r="6" fill="#ffc774"/><rect x="19" y="29" width="62" height="52" rx="17" fill="#f0f5f2"/><circle cx="37" cy="51" r="7" fill="#203640"/><circle cx="63" cy="51" r="7" fill="#203640"/><path d="M38 67q12 10 24 0" stroke="#203640" stroke-width="4" fill="none" stroke-linecap="round"/>', '0 0 100 100');
const assets = {};
const colors = ['teal', 'coral', 'violet', 'gold', 'blue', 'green'];
for (const [index, id] of colors.entries()) for (const [col, pose] of ['idle', 'walk-left', 'walk-right', 'work'].entries()) {
  const row = index % 3;
  assets[`${id}-${pose}`] = { file: `assets/robots-${index < 3 ? 'a' : 'b'}.png`, rect: [col * 384, Math.round(row * 1024 / 3), 384, Math.round((row + 1) * 1024 / 3) - Math.round(row * 1024 / 3)], height: 64 };
}
const props = [['charger', 105], ['workstation', 100], ['printer', 80], ['interface', 105], ['command', 205], ['servers', 155], ['workbench', 105], ['storage', 100]];
for (const [i, [id, height]] of props.entries()) assets[id] = { file: 'assets/datacenter-props.png', rect: [(i % 4) * 384, Math.floor(i / 4) * 512, 384, 512], height };
for (const id of ['floor', 'aisle', 'vent']) assets[id] = { file: `assets/${id}.svg`, height: 24 };
const characters = colors.map((id, i) => ({ id, name: ({ teal: 'Pip', coral: 'Ruby', violet: 'Vega', gold: 'Atlas', blue: 'Byte', green: 'Sprout' })[id], home: [4 + i * 4, 24], poses: { idle: `${id}-idle`, walk: [`${id}-walk-left`, `${id}-idle`, `${id}-walk-right`, `${id}-idle`], work: [`${id}-work`, `${id}-idle`], charge: `${id}-idle`, greet: [`${id}-idle`, `${id}-work`] } }));
const sceneObjects = [];
const add = (id, kind, tile, height = assets[kind].height) => sceneObjects.push({ id, kind, tile, height });
add('controller-wall', 'command', [7, 5]);
for (const [i, c] of characters.entries()) add(`home-${c.id}`, 'charger', [4 + i * 4, 23]);
for (const [i, tile] of [[5, 11], [10, 11], [5, 17]].entries()) add(`workstation-${i}`, 'workstation', tile);
add('printer-1', 'printer', [12, 17]); add('printer-2', 'printer', [16, 17]);
add('data-interface-1', 'interface', [14, 8]); add('data-interface-2', 'interface', [14, 12]);
add('maintenance-bench', 'workbench', [9, 17]); add('data-store', 'storage', [23, 18]);
for (const [i, tile] of [[20, 5], [24, 5], [20, 10], [24, 10], [20, 15]].entries()) add(`server-bank-${i}`, 'servers', tile);
const theme = {
  schemaVersion: 1, id: 'datacenter', name: 'Robot Datacenter', version: '1.0.1', author: 'William Pyle',
  description: 'A raised-floor datacenter staffed by six friendly robots. Each has a charging home; Atlas coordinates from a wall of monitors.',
  preview: 'assets/logo.svg', logo: 'assets/logo.svg',
  palette: { background: '#101c24', panel: '#162831', surface: '#203640', text: '#edf5f3', muted: '#9db5bd', accent: '#83d8ce', border: '#304a55', world: '#182d39', label: '#18313c' },
  assets, terrain: Object.fromEntries(['floor', 'aisle', 'vent'].map(id => [id, { asset: id, walkable: true }])),
  objects: Object.fromEntries(props.map(([id]) => [id, { asset: id, footprint: id === 'command' ? [-2, -2, 5, 3] : id === 'servers' ? [-1, -2, 3, 3] : [-1, -1, 3, 2] }])),
  scene: { world: { width: 1450, height: 1050, columns: 28, rows: 28, tileWidth: 48, tileHeight: 24, originX: 725, originY: 210 },
    terrain: Array.from({ length: 28 }, (_, v) => Array.from({ length: 28 }, (_, u) => v === 20 || u === 17 || v === 7 ? 'aisle' : u > 18 && v % 5 === 2 ? 'vent' : 'floor')),
    objects: sceneObjects, zones: [{ name: 'CONTROL', tile: [6, 2] }, { name: 'COMPUTE', tile: [21, 2] }, { name: 'WORKSTATIONS', tile: [5, 9] }, { name: 'CHARGING HOMES', tile: [13, 26] }] },
  characters, roleCharacters: { coordinator: 'gold' },
  activities: {
    patrol: { label: 'Checking the datacenter', pose: 'idle', motion: 'wander', fps: 3, duration: 18 },
    charge: { label: 'Recharging at home', pose: 'charge', motion: 'home', fps: 1, duration: 24 },
    code: { label: 'Building at a workstation', pose: 'work', motion: 'visit', targets: [[5, 12], [10, 12], [5, 18]], fps: 1.4, duration: 18 },
    maintain: { label: 'Maintaining hardware', pose: 'work', motion: 'visit', targets: [[9, 18]], fps: 2, duration: 16 },
    print: { label: 'Checking printer output', pose: 'work', motion: 'visit', targets: [[12, 18], [16, 18]], fps: 1.2, duration: 14 },
    query: { label: 'Working at a data interface', pose: 'work', motion: 'visit', targets: [[14, 9], [14, 13]], fps: 1.2, duration: 16 },
    inspect: { label: 'Inspecting the server racks', pose: 'work', motion: 'visit', targets: [[20, 6], [24, 11], [20, 16]], fps: 1.2, duration: 16 },
    control: { label: 'Coordinating at the monitor wall', pose: 'work', motion: 'visit', targets: [[7, 6]], fps: 1.2, duration: 20 },
    signal: { label: 'Sharing a status update', pose: 'greet', motion: 'stay', fps: 1, duration: 8 },
    wait: { label: 'Waiting for your answer', pose: 'idle', motion: 'stay', fps: 1, duration: 8 }
  },
  idleActivities: ['charge', 'patrol', 'maintain'],
  bindings: { default: 'code', started: 'query', build: 'code', read: 'query', research: 'query', review: 'inspect', delegate: 'control', coordinate: 'control', message: 'signal', completed: 'signal', waiting: 'wait', wait: 'wait', interrupted: 'wait', 'tool:print': 'print' },
  roleBindings: { coordinator: { default: 'control', started: 'control', delegate: 'control', coordinate: 'control', message: 'control', build: 'control', read: 'control', research: 'control', review: 'control', tool: 'control' }, lead: { delegate: 'control', coordinate: 'control' } }
};
await writeFile(path.join(dir, 'theme.json'), JSON.stringify(theme, null, 2) + '\n');
console.log('Created Robot Datacenter theme.');
