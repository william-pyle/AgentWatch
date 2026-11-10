import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = fileURLToPath(new URL('../themes/orbital/', import.meta.url));
await mkdir(path.join(dir, 'assets'), { recursive: true });
const svg = (body, box = '0 0 100 120') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>`;
const save = (name, body, box) => writeFile(path.join(dir, `assets/${name}.svg`), svg(body, box));
const assets = {};
for (const [id, color] of [['nova', '#8be0d5'], ['sol', '#f3bd79']]) {
  for (const [pose, arm, eye] of [['idle', 0, 0], ['work', 15, 0], ['wave', -20, 0], ['rest', 0, 2]]) {
    const name = `${id}-${pose}`;
    await save(name, `<ellipse cx="50" cy="111" rx="32" ry="6" fill="#070d21" opacity=".4"/><path d="M34 86v18m32-18v18" stroke="#7b91b7" stroke-width="12"/><rect x="24" y="48" width="52" height="44" rx="13" fill="${color}"/><path d="M23 62 11 ${82 + arm}m66-20 12 ${20 + arm}" stroke="${color}" stroke-width="12" stroke-linecap="round"/><rect x="19" y="18" width="62" height="43" rx="15" fill="${color}"/><rect x="28" y="29" width="44" height="23" rx="9" fill="#14223e"/><path d="M38 37v${8 - eye * 3}m24-${8 - eye * 3}v${8 - eye * 3}" stroke="#efffff" stroke-width="4" stroke-linecap="round"/><path d="M50 18V8" stroke="#7b91b7" stroke-width="4"/><circle cx="50" cy="7" r="5" fill="#f3bd79"/><circle cx="50" cy="73" r="7" fill="#14223e"/>`);
    assets[name] = { file: `assets/${name}.svg`, height: 68 };
  }
}
await save('deck', '<path d="M50 1 99 25 50 49 1 25z" fill="#293e63" stroke="#43628d"/><path d="m18 25 32 16 32-16-32-16z" fill="none" stroke="#334c75"/>', '0 0 100 50');
await save('walkway', '<path d="M50 1 99 25 50 49 1 25z" fill="#4b627c" stroke="#6b96ad"/><path d="m22 25 28 14 28-14-28-14z" fill="none" stroke="#83c9ce"/>', '0 0 100 50');
await save('console', '<path d="m12 72 38-20 38 20v31l-38 16-38-16z" fill="#27415d"/><path d="m12 72 38 20 38-20-38-20z" fill="#547d94"/><path d="M21 22 73 5v47L21 70z" fill="#18273d" stroke="#7bc5d5" stroke-width="3"/><path d="m29 35 34-12m-34 24 25-9m-25 20 34-12" stroke="#8be0d5" stroke-width="4"/>');
await save('pod', '<ellipse cx="50" cy="105" rx="39" ry="13" fill="#111e34"/><rect x="18" y="20" width="64" height="84" rx="30" fill="#4f6689"/><rect x="27" y="29" width="46" height="65" rx="22" fill="#1e3649" stroke="#83cec5" stroke-width="3"/><path d="M50 32v59" stroke="#304f61"/><circle cx="68" cy="59" r="3" fill="#f3bd79"/>');
await save('plant', '<path d="m28 80 44 0-7 30H35z" fill="#e0aa75"/><path d="M50 86V28" stroke="#6aa99b" stroke-width="5"/><path d="M49 68C5 61 20 32 49 50m2 1C88 40 86 16 52 30" fill="#8be0b7"/>');
for (const [id, height] of [['deck', 25], ['walkway', 25], ['console', 85], ['pod', 110], ['plant', 60]]) assets[id] = { file: `assets/${id}.svg`, height };
await save('logo', '<rect width="100" height="100" rx="28" fill="#223251"/><circle cx="50" cy="50" r="20" fill="none" stroke="#8be0d5" stroke-width="6"/><ellipse cx="50" cy="50" rx="42" ry="15" transform="rotate(-35 50 50)" fill="none" stroke="#f3bd79" stroke-width="5"/><circle cx="50" cy="50" r="7" fill="#8be0d5"/>', '0 0 100 100');
const theme = {
  schemaVersion: 1, id: 'orbital', name: 'Orbital Station', version: '1.0.0', author: 'William Pyle', description: 'A quiet orbital outpost. Little robots service consoles, explore the deck and recharge between tasks.',
  preview: 'assets/nova-idle.svg', logo: 'assets/logo.svg', palette: { background: '#101829', panel: '#172238', surface: '#223251', text: '#edf5ff', muted: '#a5b7d3', accent: '#8be0d5', border: '#344967', world: '#101c32', label: '#172238' }, assets,
  terrain: { deck: { asset: 'deck', walkable: true }, walkway: { asset: 'walkway', walkable: true } },
  objects: { console: { asset: 'console', footprint: [0, 0, 2, 1] }, pod: { asset: 'pod', footprint: [0, 0, 2, 2] }, plant: { asset: 'plant', footprint: [0, 0, 1, 1] } },
  scene: { world: { width: 1200, height: 800, columns: 20, rows: 20, tileWidth: 50, tileHeight: 25, originX: 600, originY: 130 },
    terrain: Array.from({ length: 20 }, (_, v) => Array.from({ length: 20 }, (_, u) => u % 5 === 2 || v % 5 === 2 ? 'walkway' : 'deck')),
    objects: [[4, 4, 'console'], [10, 4, 'console'], [16, 4, 'console'], [4, 15, 'pod'], [10, 15, 'pod'], [16, 15, 'pod'], [2, 10, 'plant'], [18, 10, 'plant']].map(([u, v, kind], i) => ({ id: `station-${i}`, kind, tile: [u, v], height: assets[kind].height })) },
  characters: ['nova', 'sol'].map(id => ({ id, name: id === 'nova' ? 'Nova' : 'Sol', poses: { idle: `${id}-idle`, walk: [`${id}-idle`, `${id}-work`], work: [`${id}-work`, `${id}-idle`], wave: [`${id}-wave`, `${id}-idle`], rest: `${id}-rest` } })),
  activities: {
    patrol: { label: 'Exploring the station', pose: 'idle', motion: 'wander', fps: 3, duration: 18 },
    recharge: { label: 'Recharging', pose: 'rest', motion: 'visit', targets: [[5, 17], [11, 17]], fps: 1, duration: 14 },
    compute: { label: 'Working at a console', pose: 'work', motion: 'visit', targets: [[5, 5], [11, 5], [17, 5]], fps: 3, duration: 20 },
    signal: { label: 'Sending a station signal', pose: 'wave', motion: 'stay', fps: 2, duration: 8 },
    standby: { label: 'Standing by', pose: 'idle', motion: 'stay', fps: 1, duration: 8 }
  }, idleActivities: ['patrol', 'recharge'], bindings: { default: 'compute', research: 'patrol', message: 'signal', delegate: 'signal', coordinate: 'signal', completed: 'signal', waiting: 'standby', wait: 'standby', interrupted: 'standby' }
};
await writeFile(path.join(dir, 'theme.json'), JSON.stringify(theme, null, 2) + '\n');
console.log('Created Orbital Station.');
