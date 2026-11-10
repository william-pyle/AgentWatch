# Agent Watch for Windows

A themeable desktop home for local Codex and Claude agents. The included **Robot Datacenter** has six friendly robots, individual charging homes, workstations, printers, data interfaces and a controller monitor wall. **Mooseville**, **Orbital Station** and **Smurfs** are optional downloads from the theme library.

[Download the Windows installer](https://github.com/william-pyle/AgentWatch/releases/latest) · [User and theme guide](docs/guide.html) · [Theme catalog](themes/index.json)

Install the x64 setup executable, open Agent Watch, and choose your project folder. Preview mode is explicitly labeled and uses sample activity. Live mode watches recent local Codex and Claude sessions, including delegates in project subfolders. The app does not send commands or messages to agents.

## Themes

Everything in a scene is theme data: terrain, scenery, character sprites and animation frames, charging homes, palettes, idle rotations, activities, destinations, and mappings from observed actions or exact tool names to activities. Make a personal copy in Theme Studio to replace images and edit the full manifest. Action and character overrides are stored separately from downloadable packs.

Choose **Edit world** beneath the scene to place and drag objects, paint terrain, resize or mirror scenery, and set homes and activity destinations. Undo/redo, duplicate, remove, save and cancel are included. Each theme's layout is stored separately, so downloaded artwork and behavior updates keep your arrangement. Mooseville includes flowing water and chimney smoke; reduced motion freezes both.

The app checks GitHub at startup for application updates and modified installed themes. App updates download in the background and offer **Restart & install**. Theme packs use content hashes, so changed artwork is detected even when the theme version is unchanged. A complete verified revision is activated atomically. Offline startup uses the included or last installed theme. Personal copies and locally modified packs are protected.

The [Smurfs theme](themes/smurfs/index.html) includes Papa as coordinator, Smurfette, Brainy, Jokey, Hefty and a reusable generic Smurf, with individual routines and a fully editable mushroom village. Use app 0.3.0 or later for role reservations and reusable character behavior.

## Development

Windows x64, Node 24 or newer:

```text
npm ci
node node_modules/electron/install.js
npm start
npm test
npm run test:desktop
npm run build
```

The installer appears in `dist/`. Tests launch isolated, hidden app instances and synthetic collector fixtures. They do not restart other applications or modify real agent sessions. Generated screenshots and test settings stay under `.test-output/`.

Theme authors edit `themes/<id>/theme.json`, add image assets, then run `npm run themes:build`. Commit the generated package manifests and `themes/index.json`. See [the guide](docs/guide.html) for the format and release procedure.

Push a `v<package-version>` tag to build and publish the Windows installer, blockmap and update metadata through GitHub Actions. Builds are currently unsigned; no signing certificate is included. See the guide before enabling publisher signing.

## Source and privacy

`src/main/` owns the Windows shell, updates, settings and theme installation. `src/collector/` reads local activity in an isolated utility process. `src/shared/` validates themes and resolves activities/navigation. `src/renderer/` renders the app and scenes. Themes cannot run code.

Observation metadata stays on the computer. Theme/update checks contact GitHub; observations are not uploaded. Raw reasoning, tool outputs, commands and transcripts are excluded from the desktop feed. A tool call is evidence of activity, not success; a finished turn does not prove an entire task is complete.

Mooseville preserves all 71 approved PNGs byte-for-byte and includes its original map and provenance. The old Alpha watcher and historical project records are retained independently. No Alpha or Mooseville runtime installation is required.
