import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ThemeStore } from '../src/main/themes.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url))), capture = process.argv.includes('--capture');
await mkdir(path.join(root, '.test-output'), { recursive: true }); const data = await mkdtemp(path.join(root, '.test-output/borg-'));
const fetcher = async url => { const relative = new URL(url).pathname.split('/main/themes/')[1]; if (!relative || relative.includes('..')) throw Error('Invalid fixture URL.'); return new Response(await readFile(path.join(root, 'themes', relative))); };
const store = new ThemeStore({ bundled: path.join(root, 'themes'), data, fetcher }); await store.init(); await store.refresh(); await store.install('borg'); assert.ok(await store.integrity('borg'));
await writeFile(path.join(data, 'settings.json'), JSON.stringify({ theme: 'borg', reducedMotion: true }));
const env = { ...process.env, AGENT_WATCH_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath: process.env.AGENT_WATCH_TEST_EXE || path.join(root, 'node_modules/electron/dist/electron.exe'), args: process.env.AGENT_WATCH_TEST_EXE ? ['--smoke-test'] : [root, '--smoke-test'], env, timeout: 45000 });
const errors = [];
try {
  const page = await application.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.waitForURL('aw://app/renderer/index.html'); await page.waitForSelector('#scene[data-ready="true"][data-theme="borg"]', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.agent-card').length === 9 && [...document.querySelectorAll('.agent-card p')].every(p => !p.textContent.includes('Arriving')));
  assert.deepEqual(await page.locator('.agent-card strong').allTextContents(), ['Borg Queen','One of Eight','Two of Eight','Three of Eight','Four of Eight','Five of Eight','Six of Eight','Seven of Eight','Eight of Eight']);
  await page.screenshot({ path: path.join(root, '.test-output/borg.png') });
  if (capture) {
    await page.locator('#scene').screenshot({ path: path.join(root, 'themes/borg/assets/preview.png') });
    const file = path.join(root, 'themes/borg/theme.json'), t = JSON.parse(await readFile(file)); t.preview = 'assets/preview.png'; await writeFile(file, JSON.stringify(t, null, 2) + '\n');
  }
  const result = await page.evaluate(async () => {
    const { Scene } = await import('./scene.mjs'), { theme } = await window.agentWatch.state();
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;left:-3000px;top:0;width:1900px;height:1260px'; document.body.append(canvas);
    const s = new Scene(canvas, () => {}); await s.load(theme); s.layout();
    const now = Date.now(), agents = Array.from({length:17},(_,i)=>({id:`borg-fixture-${i}`,role:i===16?'coordinator':'delegate',state:i===16?'working':'idle',lastSeen:new Date(now).toISOString()}));
    const settings = { reducedMotion:false, activityOverrides:{}, characterAssignments:{} };
    s.update({agents,events:[]},settings);
    const first = s.actors.get(agents[0].id), phases=[], entry=[];
    for (let n=0;n<100;n++) {
      for(const a of s.actors.values()) s.advance(a,.05,now+n*50);
      if(!phases.includes(first.dock?.stage)) phases.push(first.dock?.stage);
      if(first.dock?.stage==='entering') entry.push({position:[...first.position],...s.characterFrame(first)});
    }
    // Overflow agents travel to spare bays, so advance enough simulated time for the longest route.
    for(let n=100;n<1800;n++) for(const a of s.actors.values()) s.advance(a,.05,now+n*50);
    const docks=[...s.actors.values()].filter(a=>a.dock).map(a=>({id:a.dock.id,stage:a.dock.stage}));
    const c=document.createElement('canvas'); c.width=260;c.height=230;const ctx=c.getContext('2d');
    const light = time => {ctx.clearRect(0,0,c.width,c.height);s.environmentTime=time;s.drawLights(ctx,theme.scene.objects[0],[130,190]);return c.toDataURL();};
    const activeA=light(0),activeB=light(1000); const dock=first.dock;first.dock=null;const inactiveA=light(0),inactiveB=light(1000);first.dock=dock;
    const queen=s.actors.get(agents[16].id), animations={};
    for(const [action,pose] of [['coordinate','command'],['research','scan'],['message','commune'],['build','assemble']]) {
      queen.action=action;s.advance(queen,0,now);const frames=new Set(),pixels=new Set();
      for(let n=0;n<20;n++) {s.environmentTime=n*500;const {frame}=s.characterFrame(queen);frames.add(frame);ctx.clearRect(0,0,260,230);s.sprite(ctx,frame,[130,200]);pixels.add(c.toDataURL());}
      animations[pose]={activity:queen.activityId,frames:frames.size,pixels:pixels.size};
    }
    first.agent.state='working';first.action='build';s.advance(first,.05,now);const exitStage=first.dock?.stage;
    for(let n=0;n<800;n++)s.advance(first,.05,now+n*50);
    const resumed={dock:first.dock,activity:first.activityId,position:first.position};
    s.reducedMotion=true;first.agent.state='idle';s.advance(first,.05,now);const reduced={stage:first.dock?.stage,position:first.position,frame:s.characterFrame(first).frame};
    const alpha=[];
    for(const file of new Set(Object.values(theme.assets).map(a=>a.file))) {
      const asset=Object.values(s.assets).find(a=>a.file===file),image=asset.image; const check=document.createElement('canvas');check.width=image.naturalWidth;check.height=image.naturalHeight;const cx=check.getContext('2d');cx.drawImage(image,0,0);const pixels=cx.getImageData(0,0,check.width,check.height).data;let zero=0;for(let n=3;n<pixels.length;n+=4)if(pixels[n]===0)zero++;alpha.push({file,transparent:zero/(pixels.length/4)});
    }
    s.theme=null;s.resize.disconnect();canvas.remove();
    return {phases,entry,docks,activeLightingChanges:activeA!==activeB,vacantLightingStatic:inactiveA===inactiveB,animations,exitStage,resumed,reduced,alpha};
  });
  assert.deepEqual(result.phases,['turning','entering','docked']);
  assert.ok(result.entry.at(-1).position[1]<result.entry[0].position[1]); assert.ok(result.entry.every(e=>!e.frame.includes('back-')));
  assert.equal(result.docks.length,16);assert.equal(new Set(result.docks.map(d=>d.id)).size,16);assert.ok(result.docks.every(d=>d.stage==='docked'));
  assert.ok(result.activeLightingChanges);assert.ok(result.vacantLightingStatic);
  for(const [pose,a] of Object.entries(result.animations)){assert.equal(a.activity,`queen-${pose}`);assert.ok(a.frames>=3);assert.equal(a.pixels,a.frames);}
  assert.equal(result.exitStage,'exiting');assert.equal(result.resumed.dock,null);assert.equal(result.resumed.activity,'repair');assert.deepEqual(result.resumed.position,[12,25]);
  assert.equal(result.reduced.stage,'docked');assert.match(result.reduced.frame,/regenerate/);
  assert.equal(result.alpha.length,13);for(const a of result.alpha)assert.ok(a.transparent>.2,`${a.file} transparent background`);
  await page.locator('#edit-world').click();assert.equal(await page.locator('#editor-kind option').count(),17);
  await page.locator('#editor-object').selectOption('alcove-1');await page.locator('#editor-u').fill('7');await page.locator('#editor-u').press('Tab');await page.locator('#editor-mirror').check();
  await page.locator('#editor-save').click();await page.waitForSelector('#world-editor[hidden]',{state:'attached'});
  const saved=await page.evaluate(()=>window.agentWatch.state());assert.deepEqual(saved.theme.characters[1].home,[9,5]);assert.deepEqual(saved.baseTheme.characters[1].home,[5,7]);assert.ok(await store.integrity('borg'));
  assert.deepEqual(errors,[]);
  delete result.entry;
  await writeFile(path.join(root,'.test-output/borg-results.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),eightDrones:true,queenReserved:true,linkedAlcoveLayoutSave:true,packageIntegrity:true,...result,errors},null,2));
  console.log('Borg passed: eight drones, Queen animations, 16 occupied alcoves, backwards entry, active lighting, work resumption, reduced motion, alpha and linked layout saves.');
}catch(e){const page=await application.firstWindow();await page.screenshot({path:path.join(root,'.test-output/borg-failure.png')}).catch(()=>{});console.error(errors);throw e;}
finally{await application.close();}
