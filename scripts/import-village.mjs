// One-time import from the preserved Agent Watch source. Normal builds are independent.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest } from '../src/main/files.mjs';
const source = process.argv[2];
if (!source) throw Error('Pass the original source/ directory.');
const root = fileURLToPath(new URL('../', import.meta.url));
const page = path.join(source, 'workspace/2026-10-27_agent-watch');
const manifest = JSON.parse(await readFile(path.join(page, 'art/manifest.json'), 'utf8'));
const mapBytes = await readFile(path.join(page, 'map.json')), map = JSON.parse(mapBytes);
const { MAP_OBJECTS } = await import(pathToFileURL(path.join(source, 'scripts/agent-watch/map-model.mjs')));
const folder = path.join(root, 'themes/village'); await mkdir(path.join(folder, 'assets'), { recursive: true });
const assets = {}, provenance = [];
for (const spec of Object.values(manifest.assets).flatMap(a => a.files)) {
  const name = path.basename(spec.file), id = name.replace('.png', '');
  const bytes = await readFile(path.join(page, 'art', spec.file));
  await copyFile(path.join(page, 'art', spec.file), path.join(folder, 'assets', name));
  assets[id] = { file: `assets/${name}`, height: spec.height || 80, ...(spec.anchor ? { anchor: spec.anchor } : {}) };
  provenance.push({ file: `assets/${name}`, sha256: digest(bytes), original: `art/${spec.file}` });
}
const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const objects = Object.fromEntries(Object.entries(MAP_OBJECTS).map(([id, o]) => [kebab(id), {
  asset: path.basename(manifest.assets[o.asset].files[o.frame || 0].file, '.png'),
  footprint: o.footprint, ground: !!o.ground, ...(o.chimney ? { smoke: { anchor: o.chimney, color: '#e0e4d7', scale: 1, speed: 1 } } : {}), ...(id === 'bridge' ? { walkable: true, deck: { start: [.132, .216], end: [.89, .829] } } : {})
}]));
const characters = ['gold', 'teal', 'rust', 'sage'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), poses: {
  idle: `${id}-front-idle`, back: `${id}-back-idle`,
  walk: [`${id}-front-walk-left`, `${id}-front-walk-right`],
  'walk-back': [`${id}-back-walk-left`, `${id}-back-walk-right`],
  garden: [`${id}-front-hoe-ready`, `${id}-front-hoe-down`], sit: `${id}-front-seated`
}}));
const activities = {
  stroll: { label: 'Strolling through the village', pose: 'idle', motion: 'wander', fps: 2, duration: 18 },
  rest: { label: 'Taking a quiet break', pose: 'sit', motion: 'stay', fps: 1, duration: 12 },
  garden: { label: 'Tending the garden', pose: 'garden', motion: 'visit', targets: [[23, 11], [23, 6]], fps: 2, duration: 16 },
  craft: { label: 'Working at the workshop', pose: 'garden', motion: 'visit', targets: [[12, 14]], fps: 3, duration: 15 },
  research: { label: 'Exploring the village', pose: 'idle', motion: 'wander', fps: 2, duration: 20 },
  read: { label: 'Reading at the inn', pose: 'sit', motion: 'visit', targets: [[7, 18]], fps: 1, duration: 15 },
  meet: { label: 'Meeting at the town hall', pose: 'idle', motion: 'visit', targets: [[11, 7]], fps: 1, duration: 12 },
  review: { label: 'Checking the work', pose: 'idle', motion: 'visit', targets: [[13, 14]], fps: 2, duration: 10 },
  wait: { label: 'Waiting for your answer', pose: 'idle', motion: 'stay', fps: 1, duration: 8 },
  celebrate: { label: 'Turn finished · taking a break', pose: 'idle', motion: 'stay', fps: 2, duration: 8 }
};
const theme = {
  schemaVersion: 1, id: 'village', name: 'Mooseville', version: '1.1.0', author: 'William Pyle',
  description: 'The original hand-painted village. Moose residents craft, explore, garden and rest as your agents work.',
  preview: 'assets/gold-front-idle.png', logo: 'logo.svg',
  palette: { background: '#101a18', panel: '#182522', surface: '#21322d', text: '#eff4e9', muted: '#a5b7aa', accent: '#d9b974', border: '#34463d', world: '#1b3228', label: '#13241e' },
  assets, terrain: Object.fromEntries(['grass', 'path', 'water', 'cobble'].map(k => [k, { asset: k, walkable: k !== 'water', ...(k === 'water' ? { flow: { color: '#e4f8dd', speed: 1, direction: [0, 1] } } : {}) }])), objects,
  scene: { ...map, objects: map.objects.map(o => ({ ...o, kind: kebab(o.kind) })) }, characters, activities,
  idleActivities: ['stroll', 'rest', 'garden'],
  bindings: { default: 'craft', started: 'meet', build: 'craft', read: 'read', research: 'research', review: 'review', delegate: 'meet', message: 'meet', coordinate: 'meet', tool: 'craft', wait: 'wait', waiting: 'wait', interrupted: 'wait', completed: 'celebrate' }
};
await writeFile(path.join(folder, 'theme.json'), JSON.stringify(theme, null, 2) + '\n');
await writeFile(path.join(folder, 'source-map.json'), mapBytes);
await writeFile(path.join(folder, 'provenance.json'), JSON.stringify({ source: 'Preserved Alpha Agent Watch village, imported 2026-11-09', mapSha256: digest(mapBytes), artwork: provenance }, null, 2) + '\n');
await writeFile(path.join(folder, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#21322d"/><path d="M12 25v-9m0 9L5 20m7 5 10 9m30-9v-9m0 9 7-5m-7 5-10 9" stroke="#d9b974" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M20 29h24l-4 22H24z" fill="#d9b974"/><circle cx="27" cy="37" r="2.5" fill="#21322d"/><circle cx="37" cy="37" r="2.5" fill="#21322d"/></svg>');
console.log(`Imported ${provenance.length} original PNGs and preserved the map hash ${digest(mapBytes)}.`);
