# Excalidraw-Mirror-Guidelines-Obsidian-Plugin

An Obsidian plugin for Excalidraw to give it mirror guidelines to mirror drawings and actions you take.

## Why this plugin exists

This was built for drawing anatomy notes. I was planning on drawing the iris of an eye in Excalidraw and past a few dozen of short freehand muscle fibers along one half of the iris I realised that Excalidraw really needed a feature to make this less tiresome. The other half needed to match exactly, and doing that by hand (or with copy, flip and paste) was slow, inaccurate and frustrating.

Excalidraw has no mirror mode of its own, and I couldn't really find a community solution. Vector tools like Krita and Procreate have mirror or symmetry drawing: you place an axis, draw on one side, and the other side is drawn with you. This plugin brings that workflow to Obsidian Excalidraw, as a companion plugin that works with the official Excalidraw plugin.

## Features

- **Live procedural mirroring.** While you draw, the mirrored stroke appears on the other side of the guide at the same time, point by point. It is not a copy that appears afterwards.
- **Infinite guides.** Guides are rendered across the whole canvas by the plugin overlay. They continue past the edges of the screen and stay continuous while you pan and zoom.
- **Move and rotate guides.** Drag the dashed line to slide it (perpendicular to itself, which is the direction that changes the mirror), and drag the round handle to rotate it to any angle.
- **Angle readout.** A small label at the guide center shows the current angle in degrees and updates live.
- **Multiple guides and radial symmetry.** Add a second guide perpendicular to the first for 4 mirrored sectors, or at 45 degrees for up to 8 sectors. The plugin computes the full reflection group (up to 12 mirrored copies) so drawing in one sector fills the others.
- **Ctrl+Click mirroring for existing elements.** Lets assume you were mid-project when downloading this plugin. You've already drawn a few dozen lines and don't wish to delete and then redraw them with a guide. Simple, you just add a guide and with the selection tool active, Ctrl+Click (Cmd+Click on macOS) an existing element to place mirrored copies of it on the opposite end of the guide. Clicking again refreshes them instead of stacking duplicates.
- **Undo behavior setting.** Choose whether Ctrl+Z removes the stroke and its mirror together (default), or removes the mirrored copy first.
- **Excalidraw menu integration.** The guide actions are added to Excalidraw's menu, just click on the 3 dots in the upper bar and you should see mirror options directly under the Laser pointer item.
- **Commands and hotkeys.** Every action is also an Obsidian command, so you can bind hotkeys under Settings, Hotkeys.
- **Theme aware UI.** The guide overlay, handles and labels follow the Excalidraw light or dark theme.
- **Optional floating toolbar.** A small floating button can be shown inside the drawing view. It is off by default.
- **Local only.** The plugin makes no network requests and sends nothing anywhere.

Supported element types for mirroring: freehand strokes, lines, arrows, rectangles, ellipses, diamonds, text and images. Groups are preserved, arrow bindings and bound text labels are skipped safely.

## Requirements

- Obsidian desktop, version 1.5.0 or newer.
- The official **Excalidraw** plugin installed and enabled. This plugin is a companion and does nothing without it.

## Installation

### Step 1: Turn off Restricted mode in your vault

Restricted mode is a per-vault switch. Plugins cannot run while it is on.

1. Open Obsidian Settings.
2. Go to Community plugins.
3. If Restricted mode is on, click "Turn off Restricted mode" (or "Turn on community plugins").
4. Confirm the trust prompt for that vault.

Repeat this for each vault where you want the plugin.

### Step 2: Put the plugin into the vault's `.obsidian` folder

The plugin must live in this exact folder:

```
<YourVault>/.obsidian/plugins/excalidraw-mirror-plugin/
```

The simplest ways to get it there:

**Option A: use the install script (recommended)**

```bash
cd Excalidraw-Mirror-Guidelines-Obsidian-Plugin
./install.sh /path/to/YourVault
```

The script builds the plugin with npm when npm is available, falls back to the prebuilt `main.js` when it is not, and then copies the plugin files into `<YourVault>/.obsidian/plugins/excalidraw-mirror-plugin/`.

**Option B: copy the files manually (no build tools needed)**

This repo includes a prebuilt `main.js`, so you can skip compilation entirely.

1. Create the folder `<YourVault>/.obsidian/plugins/excalidraw-mirror-plugin/`.
2. Copy these files into it:
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `versions.json`

**Option C: build from source, then copy**

```bash
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, `styles.css` and `versions.json` into the plugin folder as in Option B.

### Step 3: Enable the plugin

1. Settings -> Community plugins -> Installed plugins.
2. Click the reload icon next to "Installed plugins" if the plugin is not listed yet.
3. Turn on **Excalidraw Mirror Plugin**.

Make sure the Excalidraw plugin is enabled too. The first time both are loaded, open an Excalidraw drawing to see the plugin working.

## Quick start

1. Open any Excalidraw drawing.
2. Add a guide: open Excalidraw's menu (the three dots) and choose **Mirror guide: add / remove all**, or click the mirror ribbon icon, or run the command from the command palette.
3. The dashed guide is placed at the center of your current selection, or at the center of the view when nothing is selected.
4. Slide the line and rotate the handle to set the mirror axis. The angle label shows the current angle.
5. Draw. The mirrored stroke follows your pen in real time.
6. To mirror something you already drew, select the selection tool and Ctrl+Click it.

## Guide controls

- **Slide the guide:** drag the dashed line. It slides perpendicular to itself.
- **Rotate the guide:** drag the round handle that sits on the line.
- **Angle label:** the number at the center of the guide shows its angle. Vertical is 90 degrees.
- **Add another guide:** menu item **Mirror guide: add another perpendicular (90°)** for 4 sectors, or **Mirror guide: add another at 45°** for more sectors.
- **Center on a selection:** select elements, then **Mirror guide: center on selection** to move every guide so the group is centered on the selection.
- **Rotate all guides:** **Mirror guide: rotate 45°** rotates every guide around their shared center.
- **Reset:** **Mirror guide: reset to vertical**.
- **Remove:** **Mirror guide: add / remove all** removes every guide and its label.

## Radial symmetry

- One guide: normal mirroring, 2 sides.
- Two perpendicular guides: 4 sectors. Draw in one, and all 4 fill in.
- Guides at 45 degrees: up to 8 sectors.
- The plugin computes reflections and their combinations, with a cap of 12 mirrored copies for performance.

## Ctrl+Click mirroring

1. Make sure the selection tool is active in Excalidraw.
2. With at least one guide in the drawing, Ctrl+Click (Cmd+Click) an element.
3. Mirrored copies are created in every other sector.
4. Ctrl+Click the same element again to refresh the copies after editing it.

Hit testing understands the shapes: strokes and lines are tested against their path, ellipses and diamonds against their shape, and boxes and text against their bounds.

## Undo behavior

Settings -> Excalidraw Mirror Plugin -> Undo behavior:

- **Remove both (default):** Ctrl+Z removes the stroke and its mirrored copies together, in one step.
- **Remove mirrored copy first:** Ctrl+Z removes only the mirrored copies first. Pressing Ctrl+Z again removes the original stroke.

In the default mode the mirrored copies are written outside Excalidraw's undo history, so the original stroke's undo step carries them. Undo and redo re-sync the mirrors automatically.

## Commands (bindable hotkeys)

Search for "Mirror guide" under Settings -> Hotkeys:

- Mirror guide: add / remove all
- Mirror guide: add another perpendicular (90°)
- Mirror guide: add another at 45°
- Mirror guide: center on selection
- Mirror guide: rotate 45°
- Mirror guide: rotate 90°
- Mirror guide: reset to vertical

## Settings

- **Add actions to Excalidraw's menu:** adds the guide actions to Excalidraw's menu, under Laser pointer. On by default.
- **Show floating toolbar:** shows a small floating Mirror button inside the drawing view. Off by default.
- **Undo behavior:** "Remove both (default)" or "Remove mirrored copy first".

## How it works

- Guides are invisible Excalidraw elements (markers) plus a plugin overlay. The overlay draws the infinite dashed line, the center dot, the rotation handle and the angle label follows the marker.
- Mirroring is done with 2D affine matrices. Each guide produces a reflection matrix. Multiple guides produce a closure of reflections and their compositions, which is how radial sectors are generated.
- While you draw, the mirrored preview is drawn on the overlay canvas so nothing is written to the scene mid-stroke. The real mirrored elements are committed shortly after the stroke finishes.
- In the default undo mode, mirrors are committed without their own undo history entry, and the engine removes or recreates them as you undo and redo.

## Development and build

Requirements: Node.js 18 or newer (for building only; the prebuilt `main.js` works without Node).

```bash
npm install       # install build dependencies (esbuild)
npm run dev       # watch mode, rebuilds main.js on change with inline sourcemaps
npm run build     # one-off production build, minified
npm run install-plugin -- /path/to/Vault   # build and copy into a vault
```

Bump versions with:

```bash
npm version patch   # or minor / major
```

This updates `manifest.json` and `versions.json` through `version-bump.mjs`.

Project layout:

```
.
├── src/main.js            # plugin source (CommonJS)
├── main.js                # built plugin, loaded by Obsidian
├── manifest.json          # Obsidian plugin manifest
├── versions.json          # plugin version to minimum Obsidian version map
├── styles.css             # plugin styles
├── esbuild.config.mjs     # bundler config
├── version-bump.mjs       # version helper used by npm version
├── install.sh             # build and copy into a vault
└── package.json
```

If you prefer not to bundle, `src/main.js` is valid CommonJS on its own. `install.sh` copies it to `main.js` when npm is unavailable.

## Troubleshooting

- **The menu entries are not under Laser pointer:** Excalidraw's menu markup can change between versions. Use the commands under Settings -> Hotkeys as a fallback, and check the developer console for the message "Excalidraw Mirror Plugin: added Mirror guide actions to Excalidraw's menu".
- **No guide appears:** make sure the plugin is enabled, the vault is not in Restricted mode, and the Excalidraw plugin is enabled. Use the ribbon icon or the command to add a guide.
- **Ctrl+Click does nothing:** the selection tool must be active and at least one guide must exist.
- **Menu items disappear after an Excalidraw update:** update this plugin, or use the commands.

## Compatibility and privacy

Tested with Obsidian 1.13.7 and the Excalidraw plugin 2.27.3 on Fedora Linux. It uses only Obsidian and Excalidraw plugin APIs, so Windows and macOS should work as well.

The plugin is fully local. It has no network access, no telemetry and no external services.

Not affiliated with Obsidian or Excalidraw. Excalidraw is a trademark of its respective owners.

## License

MIT. Copyright (c) 2026 Zoroaster1x. See [LICENSE](LICENSE).
