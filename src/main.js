/*!
 * MIT License
 *
 * Copyright (c) 2026 Zoroaster1x
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

"use strict";

const obsidian = require("obsidian");
const { Plugin, PluginSettingTab, Setting, Notice } = obsidian;

const EXCALIDRAW_PLUGIN_ID = "obsidian-excalidraw-plugin";
const VIEW_TYPE_EXCALIDRAW = "excalidraw";
const GUIDE_COLOR = "#6965db";
const GUIDE_COLOR_DARK = "#a8a5ff";
const PREVIEW_COMMIT_MS = 320;
const MAX_MIRROR_COPIES = 12;
const GUIDE_ANCHOR_LENGTH = 400;
const LABEL_OFFSETS = [0, 64, -64, 128, -128, 192, -192];

const MIRROR_TYPES = ["freedraw", "line", "arrow", "rectangle", "ellipse", "diamond", "text"];
const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomId() {
  let out = "";
  for (let i = 0; i < 16; i++) out += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return out;
}
function randomNonce() {
  return Math.floor(Math.random() * 2147483647);
}
function isMirrorGuide(el) {
  return Boolean(el && el.customData && el.customData.excalidrawMirrorGuide === true);
}
function isGuideLabel(el) {
  return Boolean(el && el.customData && el.customData.excalidrawMirrorGuideLabel === true);
}
function isMirrorClone(el) {
  return Boolean(el && el.customData && el.customData.excalidrawMirrorOf);
}
function guideEndpoints(guide) {
  const pts = guide.points || [];
  const p0 = pts[0] || [0, 0];
  const p1 = pts[pts.length - 1] || [0, 0];
  return { ax: guide.x + p0[0], ay: guide.y + p0[1], bx: guide.x + p1[0], by: guide.y + p1[1] };
}
function guideCenter(guide) {
  const { ax, ay, bx, by } = guideEndpoints(guide);
  return {
    x: (ax + bx) / 2,
    y: (ay + by) / 2,
    angle: Math.atan2(by - ay, bx - ax),
    length: Math.hypot(bx - ax, by - ay),
  };
}
function guideAngleDegrees(guide) {
  const { ax, ay, bx, by } = guideEndpoints(guide);
  let deg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  deg = ((deg % 180) + 180) % 180;
  return Math.round(deg);
}

// Transforms

function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}
function reflectionMatrix(guide) {
  const { ax, ay, bx, by } = guideEndpoints(guide);
  let dx = bx - ax;
  let dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (!len) return null;
  dx /= len;
  dy /= len;
  const dot = ax * dx + ay * dy;
  return {
    a: 2 * dx * dx - 1,
    b: 2 * dx * dy,
    c: 2 * dx * dy,
    d: 2 * dy * dy - 1,
    e: 2 * (ax - dot * dx),
    f: 2 * (ay - dot * dy),
  };
}
function composeMatrices(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}
function applyMatrix(M, x, y) {
  return { x: M.a * x + M.c * y + M.e, y: M.b * x + M.d * y + M.f };
}
function transformVector(M, x, y) {
  return { x: M.a * x + M.c * y, y: M.b * x + M.d * y };
}
function matrixDeterminant(M) {
  return M.a * M.d - M.b * M.c;
}
function matricesClose(m1, m2, eps) {
  const e = eps == null ? 1e-4 : eps;
  return (
    Math.abs(m1.a - m2.a) < e &&
    Math.abs(m1.b - m2.b) < e &&
    Math.abs(m1.c - m2.c) < e &&
    Math.abs(m1.d - m2.d) < e &&
    Math.abs(m1.e - m2.e) < e &&
    Math.abs(m1.f - m2.f) < e
  );
}
function computeTransforms(guides, cap) {
  const max = cap || MAX_MIRROR_COPIES;
  const out = [{ key: "", matrix: identityMatrix() }];
  const queue = [out[0]];
  const reflections = [];
  for (const guide of guides) {
    const matrix = reflectionMatrix(guide);
    if (matrix) reflections.push({ id: guide.id, matrix });
  }
  while (queue.length && out.length < max) {
    const current = queue.shift();
    for (const reflection of reflections) {
      if (out.length >= max) break;
      const matrix = composeMatrices(reflection.matrix, current.matrix);
      if (out.some((t) => matricesClose(t.matrix, matrix))) continue;
      const t = { key: current.key ? current.key + ">" + reflection.id : reflection.id, matrix };
      out.push(t);
      queue.push(t);
    }
  }
  return out;
}

// Elements

function transformElement(el, M, groupMap, id, transformKey) {
  const clone = JSON.parse(JSON.stringify(el));
  clone.id = id;
  clone.index = null;
  clone.version = 1;
  clone.versionNonce = randomNonce();
  clone.seed = randomNonce();
  clone.updated = Date.now();
  clone.isDeleted = false;
  clone.frameId = null;
  if (clone.startBinding) clone.startBinding = null;
  if (clone.endBinding) clone.endBinding = null;
  if (clone.boundElements) clone.boundElements = null;

  const origin = applyMatrix(M, el.x, el.y);
  if (el.points && el.points.length) {
    clone.points = el.points.map((p) => {
      const q = applyMatrix(M, el.x + p[0], el.y + p[1]);
      return [q.x - origin.x, q.y - origin.y];
    });
    clone.x = origin.x;
    clone.y = origin.y;
  } else {
    const cx = el.x + (el.width || 0) / 2;
    const cy = el.y + (el.height || 0) / 2;
    const q = applyMatrix(M, cx, cy);
    clone.x = q.x - (el.width || 0) / 2;
    clone.y = q.y - (el.height || 0) / 2;
    if (el.type !== "text") {
      const v = transformVector(M, Math.cos(el.angle || 0), Math.sin(el.angle || 0));
      clone.angle = Math.atan2(v.y, v.x);
    }
  }
  if (el.type === "image" && clone.scale && matrixDeterminant(M) < 0) {
    clone.scale = [clone.scale[0], -clone.scale[1]];
  }

  if (el.groupIds && el.groupIds.length) {
    clone.groupIds = el.groupIds.map((g) => {
      if (!groupMap[g]) groupMap[g] = randomId();
      return groupMap[g];
    });
  } else {
    clone.groupIds = [];
  }

  clone.customData = Object.assign({}, el.customData || {}, {
    excalidrawMirrorOf: el.id,
    empMirrorKey: transformKey || "",
  });
  delete clone.customData.excalidrawMirrorGuide;
  delete clone.customData.excalidrawMirrorGuideSince;
  delete clone.customData.excalidrawMirrorGuideLabel;
  delete clone.customData.excalidrawMirrorGuideLabelFor;
  return clone;
}

function getBoundingBox(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + (el.width || 0));
    maxY = Math.max(maxY, el.y + (el.height || 0));
  }
  if (!isFinite(minX)) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const fx = ax + t * dx;
  const fy = ay + t * dy;
  return Math.hypot(px - fx, py - fy);
}

function hitTestElement(el, x, y, pad) {
  if (el.points && el.points.length) {
    if (el.points.length === 1) {
      return Math.hypot(x - (el.x + el.points[0][0]), y - (el.y + el.points[0][1])) <= pad;
    }
    let best = Infinity;
    for (let i = 1; i < el.points.length; i++) {
      const ax = el.x + el.points[i - 1][0];
      const ay = el.y + el.points[i - 1][1];
      const bx = el.x + el.points[i][0];
      const by = el.y + el.points[i][1];
      best = Math.min(best, pointSegmentDistance(x, y, ax, ay, bx, by));
    }
    return best <= pad;
  }
  if (el.type === "ellipse") {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const rx = el.width / 2 + pad;
    const ry = el.height / 2 + pad;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    return nx * nx + ny * ny <= 1;
  }
  if (el.type === "diamond") {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const rx = el.width / 2 + pad;
    const ry = el.height / 2 + pad;
    if (rx <= 0 || ry <= 0) return false;
    return Math.abs(x - cx) / rx + Math.abs(y - cy) / ry <= 1;
  }
  const insideX = x >= el.x - pad && x <= el.x + (el.width || 0) + pad;
  const insideY = y >= el.y - pad && y <= el.y + (el.height || 0) + pad;
  return insideX && insideY;
}

function hitTestElements(elements, x, y, pad) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || isMirrorGuide(el) || isGuideLabel(el) || isMirrorClone(el)) continue;
    if (hitTestElement(el, x, y, pad)) return el;
  }
  return null;
}

function findDrawCanvas(host) {
  if (!host || !host.querySelectorAll) return null;
  let canvases = [];
  try {
    canvases = host.querySelectorAll("canvas");
  } catch (e) {
    return null;
  }
  for (const canvas of canvases) {
    if (canvas.classList && canvas.classList.contains("emp-overlay")) continue;
    return canvas;
  }
  return canvases.length ? canvases[0] : null;
}

// Preview drawing

function drawPreviewElement(ctx, el, tx, ty, zoom) {
  ctx.save();
  ctx.globalAlpha = Math.max(0.15, (el.opacity == null ? 100 : el.opacity) / 100);
  ctx.strokeStyle = el.strokeColor && el.strokeColor !== "transparent" ? el.strokeColor : "#1b1b1f";
  ctx.lineWidth = Math.max(0.6, (el.strokeWidth || 1) * zoom);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (el.points && el.points.length > 1) {
    ctx.beginPath();
    for (let i = 0; i < el.points.length; i++) {
      const p = el.points[i];
      const px = tx(el.x + p[0]);
      const py = ty(el.y + p[1]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  } else if (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") {
    const X = tx(el.x + el.width / 2);
    const Y = ty(el.y + el.height / 2);
    ctx.translate(X, Y);
    ctx.rotate(el.angle || 0);
    const w = el.width * zoom;
    const h = el.height * zoom;
    ctx.beginPath();
    if (el.type === "rectangle") {
      ctx.rect(-w / 2, -h / 2, w, h);
    } else if (el.type === "ellipse") {
      ctx.ellipse(0, 0, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    } else {
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(0, h / 2);
      ctx.lineTo(-w / 2, 0);
      ctx.closePath();
    }
    ctx.stroke();
  }
  ctx.restore();
}

const ICON_MIRROR =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 2.5v19" stroke-dasharray="2.4 3.2"/>' +
  '<path d="M9 5.5 4 12l5 6.5z"/>' +
  '<path d="M15 5.5 20 12l-5 6.5z"/>' +
  "</svg>";

class ExcalidrawMirrorPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.settings = { showToolbar: false, menuIntegration: true, undoMode: "both" };
    this.viewStates = new Map();
    this.toolbars = new Map();
    this.menuObservers = new Map();
    this.ctrlClickHandlers = new Map();
    this.liveHookOwner = null;
    this.previousLiveHook = null;
  }

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ExcalidrawMirrorPluginSettingTab(this));
    this.addRibbonIcon("flip-horizontal", "Mirror guide: add / remove", () => this.cmdToggleMirrorMode());
    this.addCommand({
      id: "toggle-mirror-mode",
      name: "Mirror guide: add / remove",
      callback: () => this.cmdToggleMirrorMode(),
    });
    this.addCommand({
      id: "add-perpendicular-guide",
      name: "Mirror guide: add another perpendicular (90°)",
      callback: () => this.cmdAddAnotherGuide(null, 90),
    });
    this.addCommand({
      id: "add-diagonal-guide",
      name: "Mirror guide: add another at 45°",
      callback: () => this.cmdAddAnotherGuide(null, 45),
    });
    this.addCommand({
      id: "center-guide-on-selection",
      name: "Mirror guide: center on selection",
      callback: () => this.cmdCenterGuide(),
    });
    this.addCommand({
      id: "rotate-guide-45",
      name: "Mirror guide: rotate 45°",
      callback: () => this.cmdRotateGuide(45),
    });
    this.addCommand({
      id: "rotate-guide-90",
      name: "Mirror guide: rotate 90°",
      callback: () => this.cmdRotateGuide(90),
    });
    this.addCommand({
      id: "reset-guide-vertical",
      name: "Mirror guide: reset to vertical",
      callback: () => this.cmdResetGuide(),
    });

    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncViews()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncViews()));
    this.app.workspace.onLayoutReady(() => {
      if (!this.getExcalidrawPlugin()) {
        new Notice("Excalidraw Mirror requires the Excalidraw plugin. Install and enable it to mirror drawings.");
      }
      this.installLiveHook();
      this.syncViews();
    });
  }

  onunload() {
    for (const rec of this.toolbars.values()) if (rec && rec.el) rec.el.remove();
    this.toolbars.clear();
    this.detachMenuObservers();
    for (const [view, handler] of this.ctrlClickHandlers) {
      const host = view.excalidrawContainer;
      if (host && host.removeEventListener) host.removeEventListener("pointerdown", handler, true);
    }
    this.ctrlClickHandlers.clear();
    for (const state of this.viewStates.values()) {
      if (state.commitTimer) clearTimeout(state.commitTimer);
      if (state.overlay && state.overlay.canvas) state.overlay.canvas.remove();
      if (state.guideUI) {
        for (const rec of state.guideUI.values()) {
          if (rec.hit) rec.hit.remove();
          if (rec.handle) rec.handle.remove();
        }
        state.guideUI.clear();
      }
    }
    this.viewStates.clear();
    const ex = this.getExcalidrawPlugin();
    if (ex && ex.ea && ex.ea.onSceneChangeHook === this.liveHookOwner) {
      ex.ea.onSceneChangeHook = this.previousLiveHook || null;
    }
    this.liveHookOwner = null;
    this.previousLiveHook = null;
  }

  async loadSettings() {
    this.settings = Object.assign({ showToolbar: false, menuIntegration: true, undoMode: "both" }, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  getExcalidrawPlugin() {
    const plugins = this.app.plugins && this.app.plugins.plugins;
    return (plugins && plugins[EXCALIDRAW_PLUGIN_ID]) || null;
  }
  getExcalidrawViews() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_EXCALIDRAW).map((leaf) => leaf.view).filter((view) => view && view.excalidrawAPI);
  }
  getActiveExcalidrawView() {
    const leaf = this.app.workspace.getMostRecentLeaf && this.app.workspace.getMostRecentLeaf();
    const view = leaf && leaf.view;
    if (view && view.getViewType && view.getViewType() === VIEW_TYPE_EXCALIDRAW && view.excalidrawAPI) {
      return view;
    }
    return this.getExcalidrawViews()[0] || null;
  }

  getCommandTarget(view) {
    const target = view || this.getActiveExcalidrawView();
    if (!target) new Notice("Excalidraw Mirror: open an Excalidraw drawing first.");
    return target;
  }

  getState(view) {
    const key = (view.file && view.file.path) || view.id || "default";
    let state = this.viewStates.get(key);
    if (!state) {
      state = {
        tracked: new Map(),
        groupMap: {},
        suppressed: new Map(),
        pending: new Map(),
        commitTimer: null,
        overlay: null,
        guideUI: new Map(),
        busy: false,
      };
      this.viewStates.set(key, state);
    }
    return state;
  }

  syncViews() {
    this.installLiveHook();
    const views = this.getExcalidrawViews();
    for (const view of views) {
      if (this.settings.showToolbar) this.attachToolbar(view);
      else this.removeToolbar(view);
      this.attachCtrlClick(view);
      this.updateToolbar(view);
      const guides = this.findGuides(view);
      if (guides.length) {
        const state = this.getState(view);
        this.drawOverlay(view, state, guides, computeTransforms(guides), view.excalidrawAPI.getAppState());
      }
    }
    if (this.settings.menuIntegration) this.ensureMenuObservers();
    else this.detachMenuObservers();
    for (const [view, rec] of Array.from(this.toolbars.entries())) {
      if (views.indexOf(view) === -1 || !rec.el.isConnected) {
        rec.el.remove();
        this.toolbars.delete(view);
      }
    }
  }

  // Scene helpers

  getScene(view) {
    return view.excalidrawAPI.getSceneElements().filter((el) => !el.isDeleted);
  }
  getSelectedElements(view) {
    const appState = view.excalidrawAPI.getAppState();
    const selected = (appState && appState.selectedElementIds) || {};
    return view.excalidrawAPI.getSceneElements().filter((el) => !el.isDeleted && selected[el.id]);
  }
  getMirrorableSelection(view) {
    return this.getSelectedElements(view).filter(
      (el) => !isMirrorGuide(el) && !isGuideLabel(el) && !isMirrorClone(el)
    );
  }
  findGuides(view) {
    return this.getScene(view).filter(isMirrorGuide);
  }
  findGuideById(view, id) {
    return this.getScene(view).find((el) => el.id === id && isMirrorGuide(el)) || null;
  }
  writeScene(view, elements, captureUpdate) {
    view.updateScene({ elements, appState: view.excalidrawAPI.getAppState(), captureUpdate: captureUpdate || "IMMEDIATELY" });
  }
  selectElementsByIds(view, ids) {
    try {
      view.updateScene({
        appState: Object.assign({}, view.excalidrawAPI.getAppState(), {
          selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
        }),
        captureUpdate: "NEVER",
      });
    } catch (e) {
      /* ignore */
    }
  }

  clientToScene(view, clientX, clientY) {
    const host = view.excalidrawContainer;
    if (!host || !host.querySelector) return null;
    const canvas = findDrawCanvas(host);
    if (!canvas || !canvas.getBoundingClientRect) return null;
    const rect = canvas.getBoundingClientRect();
    const appState = view.excalidrawAPI.getAppState() || {};
    const zoom = (appState.zoom && appState.zoom.value) || 1;
    return {
      x: (clientX - rect.left) / zoom - (appState.scrollX || 0),
      y: (clientY - rect.top) / zoom - (appState.scrollY || 0),
    };
  }

  // Guides

  makeGuide(cx, cy, angleDeg) {
    const rad = ((angleDeg == null ? 90 : angleDeg) * Math.PI) / 180;
    const dx = Math.cos(rad) * GUIDE_ANCHOR_LENGTH;
    const dy = Math.sin(rad) * GUIDE_ANCHOR_LENGTH;
    return {
      id: randomId(),
      type: "line",
      x: cx - dx / 2,
      y: cy - dy / 2,
      width: Math.abs(dx),
      height: Math.abs(dy),
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: randomNonce(),
      version: 1,
      versionNonce: randomNonce(),
      updated: Date.now(),
      isDeleted: false,
      boundElements: null,
      points: [[0, 0], [dx, dy]],
      lastCommittedPoint: null,
      customData: { excalidrawMirrorGuide: true, excalidrawMirrorGuideSince: Date.now() },
      index: null,
    };
  }

  makeGuideLabel(guide, index) {
    const center = guideCenter(guide);
    const offset = LABEL_OFFSETS[index % LABEL_OFFSETS.length] || 0;
    const text = guideAngleDegrees(guide) + "°";
    return {
      id: randomId(),
      type: "text",
      x: center.x + Math.cos(center.angle) * offset - 16,
      y: center.y + Math.sin(center.angle) * offset - 11,
      width: 32,
      height: 22,
      angle: 0,
      strokeColor: GUIDE_COLOR,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 85,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: randomNonce(),
      version: 1,
      versionNonce: randomNonce(),
      updated: Date.now(),
      isDeleted: false,
      boundElements: null,
      containerId: null,
      locked: true,
      text,
      originalText: text,
      rawText: text,
      fontSize: 16,
      fontFamily: 2,
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.25,
      customData: { excalidrawMirrorGuideLabel: true, excalidrawMirrorGuideLabelFor: guide.id },
      index: null,
    };
  }

  labelUpdateFor(alive, guide, index) {
    const label = alive.find((el) => isGuideLabel(el) && el.customData.excalidrawMirrorGuideLabelFor === guide.id);
    if (!label) return null;
    const center = guideCenter(guide);
    const offset = LABEL_OFFSETS[index % LABEL_OFFSETS.length] || 0;
    let deg = (center.angle * 180) / Math.PI;
    deg = ((deg % 180) + 180) % 180;
    const text = Math.round(deg) + "°";
    const nx = center.x + Math.cos(center.angle) * offset - (label.width || 32) / 2;
    const ny = center.y + Math.sin(center.angle) * offset - (label.height || 22) / 2;
    if (label.text === text && Math.abs(label.x - nx) < 0.6 && Math.abs(label.y - ny) < 0.6) return null;
    return Object.assign({}, label, {
      text,
      originalText: text,
      rawText: text,
      x: nx,
      y: ny,
      version: (label.version || 1) + 1,
      versionNonce: randomNonce(),
      updated: Date.now(),
    });
  }

  writeGuides(view, updatedGuides, captureUpdate) {
    const scene = view.excalidrawAPI.getSceneElements().slice();
    const byId = new Map(updatedGuides.map((g) => [g.id, g]));
    let next = scene.map((el) => byId.get(el.id) || el);
    const alive = next.filter((el) => !el.isDeleted);
    const updates = new Map();
    const guides = alive.filter(isMirrorGuide);
    guides.forEach((guide, index) => {
      const label = this.labelUpdateFor(alive, guide, index);
      if (label) updates.set(label.id, label);
    });
    if (updates.size) next = next.map((el) => updates.get(el.id) || el);
    this.writeScene(view, next, captureUpdate || "IMMEDIATELY");
  }

  addGuide(view, angleDeg) {
    const selection = this.getMirrorableSelection(view);
    const guides = this.findGuides(view);
    let cx;
    let cy;
    if (guides.length) {
      const centers = guides.map(guideCenter);
      cx = centers.reduce((s, c) => s + c.x, 0) / centers.length;
      cy = centers.reduce((s, c) => s + c.y, 0) / centers.length;
    } else if (selection.length) {
      const bounds = getBoundingBox(selection);
      cx = bounds.cx;
      cy = bounds.cy;
    } else {
      const appState = view.excalidrawAPI.getAppState() || {};
      const zoom = (appState.zoom && appState.zoom.value) || 1;
      cx = -(appState.scrollX || 0) + (appState.width || 900) / zoom / 2;
      cy = -(appState.scrollY || 0) + (appState.height || 700) / zoom / 2;
    }
    const guide = this.makeGuide(cx, cy, angleDeg == null ? 90 : angleDeg);
    const label = this.makeGuideLabel(guide, guides.length);
    const scene = view.excalidrawAPI.getSceneElements().slice();
    this.writeScene(view, scene.concat([guide, label]));
    this.selectElementsByIds(view, [guide.id]);
    return guide;
  }

  removeAllGuides(view) {
    const scene = view.excalidrawAPI.getSceneElements().slice();
    const next = scene.filter((el) => !isMirrorGuide(el) && !isGuideLabel(el));
    if (next.length !== scene.length) this.writeScene(view, next);
  }

  shiftGuide(guide, center) {
    const current = guideCenter(guide);
    return Object.assign({}, guide, {
      x: guide.x + (center.x - current.x),
      y: guide.y + (center.y - current.y),
      version: (guide.version || 1) + 1,
      versionNonce: randomNonce(),
      updated: Date.now(),
    });
  }

  setGuideAngle(guide, angleRad) {
    const center = guideCenter(guide);
    const length = Math.max(240, center.length);
    const dx = Math.cos(angleRad) * length;
    const dy = Math.sin(angleRad) * length;
    return Object.assign({}, guide, {
      x: center.x - dx / 2,
      y: center.y - dy / 2,
      points: [[0, 0], [dx, dy]],
      width: Math.abs(dx),
      height: Math.abs(dy),
      version: (guide.version || 1) + 1,
      versionNonce: randomNonce(),
      updated: Date.now(),
    });
  }

  rotateGuides(view, degrees) {
    const guides = this.findGuides(view);
    if (!guides.length) {
      new Notice("Excalidraw Mirror: add a mirror guide first.");
      return;
    }
    const centers = guides.map(guideCenter);
    const cx = centers.reduce((s, c) => s + c.x, 0) / centers.length;
    const cy = centers.reduce((s, c) => s + c.y, 0) / centers.length;
    const rad = (degrees * Math.PI) / 180;
    const updated = guides.map((guide) => {
      const center = guideCenter(guide);
      const shifted = this.shiftGuide(guide, { x: cx, y: cy });
      return this.setGuideAngle(shifted, center.angle + rad);
    });
    this.writeGuides(view, updated);
  }

  resetGuidesVertical(view) {
    const guides = this.findGuides(view);
    if (!guides.length) {
      new Notice("Excalidraw Mirror: add a mirror guide first.");
      return;
    }
    this.writeGuides(view, guides.map((g) => this.setGuideAngle(g, Math.PI / 2)));
  }

  centerGuidesOnSelection(view) {
    const guides = this.findGuides(view);
    if (!guides.length) {
      new Notice("Excalidraw Mirror: add a mirror guide first.");
      return;
    }
    const selection = this.getMirrorableSelection(view);
    if (!selection.length) {
      new Notice("Excalidraw Mirror: select the elements to center the guide on.");
      return;
    }
    const bounds = getBoundingBox(selection);
    if (!bounds) return;
    const centers = guides.map(guideCenter);
    const cx = centers.reduce((s, c) => s + c.x, 0) / centers.length;
    const cy = centers.reduce((s, c) => s + c.y, 0) / centers.length;
    const moved = guides.map((g) => {
      const center = guideCenter(g);
      return this.shiftGuide(g, { x: center.x + (bounds.cx - cx), y: center.y + (bounds.cy - cy) });
    });
    this.writeGuides(view, moved);
  }

  // Commands

  cmdToggleMirrorMode(view) {
    const target = this.getCommandTarget(view);
    if (!target) return;
    if (this.findGuides(target).length) {
      this.removeAllGuides(target);
      new Notice("Mirror guides removed.");
      this.updateToolbar(target);
      return;
    }
    const selection = this.getMirrorableSelection(target);
    this.addGuide(target, 90);
    new Notice(
      selection.length
        ? "Mirror guide added at the selection center. Drag or rotate it, then draw."
        : "Mirror guide added. Drag or rotate it, then draw."
    );
    this.updateToolbar(target);
  }

  cmdAddAnotherGuide(view, degrees) {
    const target = this.getCommandTarget(view);
    if (!target) return;
    const step = degrees == null ? 90 : degrees;
    const guides = this.findGuides(target);
    const last = guides[guides.length - 1];
    this.addGuide(target, last ? guideAngleDegrees(last) + step : 90);
    new Notice("Mirror guide added at +" + step + "°.");
  }

  cmdCenterGuide(view) {
    const target = this.getCommandTarget(view);
    if (!target) return;
    this.centerGuidesOnSelection(target);
  }

  cmdRotateGuide(degrees, view) {
    const target = this.getCommandTarget(view);
    if (!target) return;
    this.rotateGuides(target, degrees);
  }

  cmdResetGuide(view) {
    const target = this.getCommandTarget(view);
    if (!target) return;
    this.resetGuidesVertical(target);
  }

  // Ctrl+click mirroring

  attachCtrlClick(view) {
    if (this.ctrlClickHandlers.has(view)) return;
    const host = view.excalidrawContainer;
    if (!host || !host.addEventListener) return;
    const handler = (evt) => this.onHostPointerDown(view, evt);
    host.addEventListener("pointerdown", handler, true);
    this.ctrlClickHandlers.set(view, handler);
  }

  onHostPointerDown(view, evt) {
    if (!(evt.ctrlKey || evt.metaKey) || evt.button !== 0) return;
    const appState = view.excalidrawAPI.getAppState() || {};
    const tool = appState.activeTool && appState.activeTool.type;
    if (tool !== "selection") return;
    if (!this.findGuides(view).length) return;
    const point = this.clientToScene(view, evt.clientX, evt.clientY);
    if (!point) return;
    const zoom = (appState.zoom && appState.zoom.value) || 1;
    const hit = hitTestElements(this.getScene(view), point.x, point.y, 8 / zoom);
    if (!hit) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.mirrorExistingElement(view, hit);
  }

  mirrorExistingElement(view, src) {
    const state = this.getState(view);
    const guides = this.findGuides(view);
    const transforms = computeTransforms(guides).filter((t) => t.key);
    if (!transforms.length) return;
    const scene = view.excalidrawAPI.getSceneElements().slice();
    const kept = scene.filter((el) => !(el.customData && el.customData.excalidrawMirrorOf === src.id));
    const additions = [];
    const tracking = new Map();
    for (const t of transforms) {
      const twin = transformElement(src, t.matrix, state.groupMap, randomId(), t.key);
      additions.push(twin);
      tracking.set(t.key, { twinId: twin.id, version: src.version, versionNonce: src.versionNonce });
    }
    state.tracked.set(src.id, tracking);
    state.suppressed.delete(src.id);
    const capture = this.settings.undoMode === "mirrorFirst" ? "IMMEDIATELY" : "NEVER";
    this.writeScene(view, kept.concat(additions), capture);
    if (view.excalidrawAPI.setToast) {
      try {
        view.excalidrawAPI.setToast({ message: "Mirrored", duration: 1200, closable: false });
      } catch (e) {
        /* ignore */
      }
    }
  }

  // Live mirror engine

  installLiveHook() {
    const ex = this.getExcalidrawPlugin();
    if (!ex || !ex.ea) return false;
    const existing = ex.ea.onSceneChangeHook;
    if (existing && existing.__excalidrawMirrorPlugin) {
      this.liveHookOwner = existing;
      return true;
    }
    const previous = existing || null;
    const owner = this;
    const previousKeys = previous && previous.appStateKeys ? previous.appStateKeys.slice() : [];
    for (const key of ["scrollX", "scrollY", "zoom"]) if (previousKeys.indexOf(key) === -1) previousKeys.push(key);
    const hook = {
      __excalidrawMirrorPlugin: true,
      trackElements: true,
      triggerWhenInvisible: true,
      appStateKeys: previousKeys,
      callback(elements, appState, files, view) {
        if (previous && typeof previous.callback === "function") {
          try {
            previous.callback(elements, appState, files, view);
          } catch (e) {
            console.error("Excalidraw Mirror: previous scene hook failed", e);
          }
        }
        owner.onSceneChange(elements, appState, files, view);
      },
    };
    ex.ea.onSceneChangeHook = hook;
    this.liveHookOwner = hook;
    this.previousLiveHook = previous;
    return true;
  }

  onSceneChange(elements, appState, files, view) {
    if (!view || !view.excalidrawAPI) return;
    const state = this.getState(view);
    if (state.busy) return;

    const alive = elements.filter((el) => !el.isDeleted);
    const guides = alive.filter(isMirrorGuide);
    const transforms = computeTransforms(guides);
    const refMap = new Map(transforms.filter((t) => t.key).map((t) => [t.key, t]));
    const byId = new Map(alive.map((el) => [el.id, el]));
    const sceneUpdates = new Map();
    const deletions = new Set();

    // Keep guide anchors invisible and update angle labels.
    guides.forEach((guide, index) => {
      if (guide.strokeColor !== "transparent") {
        sceneUpdates.set(guide.id, Object.assign({}, guide, {
          strokeColor: "transparent",
          version: (guide.version || 1) + 1,
          versionNonce: randomNonce(),
          updated: Date.now(),
        }));
      }
      const labelUpdate = this.labelUpdateFor(alive, guide, index);
      if (labelUpdate) sceneUpdates.set(labelUpdate.id, labelUpdate);
    });

    // Reconcile existing clones (e.g. after redo) into the tracking map.
    for (const el of alive) {
      if (!isMirrorClone(el)) continue;
      const srcId = el.customData.excalidrawMirrorOf;
      const key = el.customData.empMirrorKey || "";
      if (!key || !refMap.has(key)) continue;
      const src = byId.get(srcId);
      if (!src) continue;
      let map = state.tracked.get(srcId);
      if (!map) {
        map = new Map();
        state.tracked.set(srcId, map);
      }
      if (!map.has(key)) map.set(key, { twinId: el.id, version: src.version, versionNonce: src.versionNonce });
    }

    // Sync tracked twins with their originals.
    for (const [srcId, map] of Array.from(state.tracked.entries())) {
      const src = byId.get(srcId);
      if (!src) {
        for (const info of map.values()) {
          const twin = byId.get(info.twinId);
          if (twin) deletions.add(twin.id);
        }
        state.tracked.delete(srcId);
        continue;
      }
      for (const [key, info] of Array.from(map.entries())) {
        const twin = byId.get(info.twinId);
        if (!twin) {
          map.delete(key);
          let set = state.suppressed.get(srcId);
          if (!set) {
            set = new Set();
            state.suppressed.set(srcId, set);
          }
          set.add(key);
          continue;
        }
        const t = refMap.get(key);
        if (!t) {
          deletions.add(info.twinId);
          map.delete(key);
          continue;
        }
        if (src.version !== info.version || src.versionNonce !== info.versionNonce) {
          const fresh = transformElement(src, t.matrix, state.groupMap, info.twinId, key);
          fresh.index = twin.index;
          sceneUpdates.set(fresh.id, fresh);
          info.version = src.version;
          info.versionNonce = src.versionNonce;
        }
      }
      if (!map.size) state.tracked.delete(srcId);
    }

    // Preview new strokes on the overlay, then commit them once the stroke ends.
    if (guides.length) {
      const since = Math.min(
        ...guides.map((g) =>
          typeof g.customData.excalidrawMirrorGuideSince === "number" ? g.customData.excalidrawMirrorGuideSince : g.updated
        )
      );
      alive.forEach((el) => {
        if (isMirrorGuide(el) || isGuideLabel(el) || isMirrorClone(el)) return;
        if (state.tracked.has(el.id) || state.pending.has(el.id)) return;
        const suppressed = state.suppressed.get(el.id);
        if (suppressed && suppressed.size) return;
        if (!MIRROR_TYPES.includes(el.type)) return;
        if (el.type === "text" && el.containerId) return;
        if (typeof el.updated === "number" && el.updated < since) return;
        state.pending.set(el.id, el);
      });
    }

    this.drawOverlay(view, state, guides, transforms, appState || view.excalidrawAPI.getAppState());
    if (state.pending.size) this.scheduleCommit(view, state);

    const hasTwinUpdates = Array.from(sceneUpdates.values()).some((el) => isMirrorClone(el));
    const capture = this.settings.undoMode === "mirrorFirst" && hasTwinUpdates ? "IMMEDIATELY" : "NEVER";
    if (sceneUpdates.size || deletions.size) {
      state.busy = true;
      try {
        const current = view.excalidrawAPI.getSceneElements().slice();
        let next = current;
        if (deletions.size) next = next.filter((el) => !deletions.has(el.id));
        if (sceneUpdates.size) next = next.map((el) => sceneUpdates.get(el.id) || el);
        this.writeScene(view, next, capture);
      } catch (e) {
        console.error("Excalidraw Mirror: live update failed", e);
      } finally {
        state.busy = false;
      }
    }
  }

  scheduleCommit(view, state) {
    if (state.commitTimer) clearTimeout(state.commitTimer);
    state.commitTimer = setTimeout(() => {
      state.commitTimer = null;
      this.commitPending(view, state);
    }, PREVIEW_COMMIT_MS);
  }

  commitPending(view, state) {
    if (!state.pending.size) return;
    const guides = this.findGuides(view);
    const transforms = computeTransforms(guides).filter((t) => t.key);
    if (!transforms.length) {
      state.pending.clear();
      return;
    }
    const scene = view.excalidrawAPI.getSceneElements().slice();
    const byId = new Map(scene.map((el) => [el.id, el]));
    const additions = [];
    for (const id of Array.from(state.pending.keys())) {
      state.pending.delete(id);
      const el = byId.get(id);
      if (!el || el.isDeleted) continue;
      const map = new Map();
      for (const t of transforms) {
        const suppressed = state.suppressed.get(id);
        if (suppressed && suppressed.has(t.key)) continue;
        const twin = transformElement(el, t.matrix, state.groupMap, randomId(), t.key);
        additions.push(twin);
        map.set(t.key, { twinId: twin.id, version: el.version, versionNonce: el.versionNonce });
      }
      if (map.size) state.tracked.set(id, map);
    }
    const capture = this.settings.undoMode === "mirrorFirst" ? "IMMEDIATELY" : "NEVER";
    if (additions.length) this.writeScene(view, scene.concat(additions), capture);
  }

  // Overlay and guide UI

  ensureOverlay(view, state) {
    if (state.overlay) return state.overlay;
    if (typeof document === "undefined") return null;
    const host = view.excalidrawContainer;
    if (!host || !host.ownerDocument) return null;
    const canvas = host.ownerDocument.createElement("canvas");
    canvas.className = "emp-overlay";
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "1",
    });
    const canvases = host.querySelectorAll("canvas");
    const anchor = canvases.length ? canvases[canvases.length - 1] : null;
    if (anchor && anchor.parentElement) anchor.insertAdjacentElement("afterend", canvas);
    else host.appendChild(canvas);
    state.overlay = { canvas, ctx: canvas.getContext ? canvas.getContext("2d") : null };
    return state.overlay;
  }

  drawOverlay(view, state, guides, transforms, appState) {
    const overlay = this.ensureOverlay(view, state);
    if (!overlay || !overlay.ctx || typeof window === "undefined") return;
    const { canvas, ctx } = overlay;
    const host = view.excalidrawContainer;
    const dpr = window.devicePixelRatio || 1;
    const cw = (host && host.clientWidth) || (appState && appState.width) || 800;
    const ch = (host && host.clientHeight) || (appState && appState.height) || 600;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!appState) return;

    let offX = 0;
    let offY = 0;
    if (host && host.querySelector && canvas.getBoundingClientRect) {
      const drawCanvas = findDrawCanvas(host);
      if (drawCanvas && drawCanvas.getBoundingClientRect) {
        const drawRect = drawCanvas.getBoundingClientRect();
        const overlayRect = canvas.getBoundingClientRect();
        offX = drawRect.left - overlayRect.left;
        offY = drawRect.top - overlayRect.top;
      }
    }
    const zoom = (appState.zoom && appState.zoom.value) || 1;
    const scrollX = appState.scrollX || 0;
    const scrollY = appState.scrollY || 0;
    const tx = (x) => (x + scrollX) * zoom + offX;
    const ty = (y) => (y + scrollY) * zoom + offY;
    const dark = appState.theme === "dark";
    const color = dark ? GUIDE_COLOR_DARK : GUIDE_COLOR;

    // Infinite dashed guides.
    const diag = Math.hypot(cw, ch) * 1.4;
    const handles = [];
    for (const guide of guides) {
      const center = guideCenter(guide);
      const sx = tx(center.x);
      const sy = ty(center.y);
      const dx = Math.cos(center.angle);
      const dy = Math.sin(center.angle);
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - dx * diag, sy - dy * diag);
      ctx.lineTo(sx + dx * diag, sy + dy * diag);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      const hx = sx + dx * 64;
      const hy = sy + dy * 64;
      ctx.beginPath();
      ctx.arc(hx, hy, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = dark ? "#1e1e1e" : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      handles.push({ guideId: guide.id, sx, sy, hx, hy, angle: center.angle, diag });
    }

    // Live previews of pending strokes for every transform.
    if (state.pending.size) {
      const refTransforms = transforms.filter((t) => t.key);
      state.pending.forEach((el) => {
        for (const t of refTransforms) {
          const preview = transformElement(el, t.matrix, {}, randomId(), t.key);
          drawPreviewElement(ctx, preview, tx, ty, zoom);
        }
      });
    }

    this.updateGuideUI(view, state, handles);
  }

  updateGuideUI(view, state, handles) {
    const host = view.excalidrawContainer;
    if (!host || typeof document === "undefined") return;
    const seen = new Set();
    for (const h of handles) {
      seen.add(h.guideId);
      let rec = state.guideUI.get(h.guideId);
      if (!rec) {
        const doc = host.ownerDocument;
        const hit = doc.createElement("div");
        hit.className = "emp-guide-hit";
        const handle = doc.createElement("div");
        handle.className = "emp-guide-handle";
        hit.addEventListener("pointerdown", (evt) => this.startGuideMove(view, h.guideId, evt));
        handle.addEventListener("pointerdown", (evt) => this.startGuideRotate(view, h.guideId, evt));
        host.appendChild(hit);
        host.appendChild(handle);
        rec = { hit, handle };
        state.guideUI.set(h.guideId, rec);
      }
      Object.assign(rec.hit.style, {
        left: h.sx + "px",
        top: h.sy + "px",
        width: Math.round(h.diag * 2) + "px",
        transform: `translate(-50%, -50%) rotate(${h.angle}rad)`,
      });
      Object.assign(rec.handle.style, {
        left: h.hx + "px",
        top: h.hy + "px",
        transform: "translate(-50%, -50%)",
      });
    }
    for (const [guideId, rec] of Array.from(state.guideUI.entries())) {
      if (seen.has(guideId)) continue;
      if (rec.hit) rec.hit.remove();
      if (rec.handle) rec.handle.remove();
      state.guideUI.delete(guideId);
    }
  }

  startGuideMove(view, guideId, evt) {
    if (evt.button !== 0) return;
    evt.preventDefault();
    evt.stopPropagation();
    const guide = this.findGuideById(view, guideId);
    if (!guide) return;
    const start = this.clientToScene(view, evt.clientX, evt.clientY);
    if (!start) return;
    const center = guideCenter(guide);
    const normal = { x: -Math.sin(center.angle), y: Math.cos(center.angle) };
    const move = (e) => {
      const cur = this.clientToScene(view, e.clientX, e.clientY);
      if (!cur) return;
      const proj = (cur.x - start.x) * normal.x + (cur.y - start.y) * normal.y;
      const g = this.findGuideById(view, guideId);
      if (!g) return;
      const moved = this.shiftGuide(g, {
        x: center.x + normal.x * proj,
        y: center.y + normal.y * proj,
      });
      this.writeGuides(view, [moved], "NEVER");
    };
    const up = () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      }
      const g = this.findGuideById(view, guideId);
      if (g) this.writeGuides(view, [g], "IMMEDIATELY");
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }
  }

  startGuideRotate(view, guideId, evt) {
    if (evt.button !== 0) return;
    evt.preventDefault();
    evt.stopPropagation();
    const guide = this.findGuideById(view, guideId);
    if (!guide) return;
    const center = guideCenter(guide);
    const first = this.clientToScene(view, evt.clientX, evt.clientY);
    if (!first) return;
    const startAngle = Math.atan2(first.y - center.y, first.x - center.x);
    const startGuideAngle = center.angle;
    const move = (e) => {
      const cur = this.clientToScene(view, e.clientX, e.clientY);
      if (!cur) return;
      const angle = Math.atan2(cur.y - center.y, cur.x - center.x);
      const g = this.findGuideById(view, guideId);
      if (!g) return;
      const rotated = this.setGuideAngle(g, startGuideAngle + (angle - startAngle));
      this.writeGuides(view, [rotated], "NEVER");
    };
    const up = () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      }
      const g = this.findGuideById(view, guideId);
      if (g) this.writeGuides(view, [g], "IMMEDIATELY");
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }
  }

  // Excalidraw menu integration

  ensureMenuObservers() {
    const docs = new Set();
    for (const view of this.getExcalidrawViews()) {
      const host = view.contentEl || view.containerEl;
      if (host && host.ownerDocument) docs.add(host.ownerDocument);
    }
    if (typeof document !== "undefined") docs.add(document);
    for (const doc of docs) this.ensureMenuObserver(doc);
  }
  ensureMenuObserver(doc) {
    if (!doc || !doc.body || typeof MutationObserver === "undefined") return;
    if (this.menuObservers.has(doc)) return;
    const observer = new MutationObserver(() => this.scanForMirrorMenuAnchors(doc));
    observer.observe(doc.body, { childList: true, subtree: true });
    this.menuObservers.set(doc, observer);
    this.scanForMirrorMenuAnchors(doc);
  }
  detachMenuObservers() {
    for (const observer of this.menuObservers.values()) {
      try {
        observer.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    this.menuObservers.clear();
  }
  scanForMirrorMenuAnchors(doc) {
    if (!doc || !doc.querySelectorAll) return;
    const candidates = new Map();
    let nodes;
    try {
      nodes = doc.querySelectorAll("button, [role='menuitem'], li, label");
    } catch (e) {
      return;
    }
    for (const node of nodes) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      const isLaser = /^laser pointer/i.test(text);
      const isFallback = /^(zen mode|help)$/i.test(text);
      if (!isLaser && !isFallback) continue;
      let item = node;
      if (!node.matches("button, [role='menuitem']") && node.closest) {
        item = node.closest("button, [role='menuitem'], .dropdown-menu-item") || node;
      }
      const menu = item.parentElement;
      if (!menu || !menu.querySelectorAll) continue;
      if (menu.querySelector("[data-emp-menu]")) continue;
      const existing = candidates.get(menu);
      if (!existing || (isLaser && !existing.isLaser)) candidates.set(menu, { anchor: item, isLaser });
    }
    for (const [menu, info] of candidates) {
      if (menu.querySelector("[data-emp-menu]")) continue;
      this.injectAfterAnchor(menu, info.anchor, doc);
    }
  }
  injectAfterAnchor(menu, anchor, doc) {
    let ref = anchor;
    for (const entry of this.getMenuEntries()) {
      const item = this.cloneMenuItem(anchor, entry, doc);
      const parent = ref.parentElement || menu;
      if (parent && parent.insertBefore) parent.insertBefore(item, ref.nextSibling);
      else menu.appendChild(item);
      ref = item;
    }
    console.log("Excalidraw Mirror: added Mirror guide actions to Excalidraw's menu");
  }
  cloneMenuItem(anchor, entry, doc) {
    const item = anchor.cloneNode(true);
    ["aria-checked", "aria-expanded", "aria-controls", "aria-keyshortcuts", "data-testid", "id", "for", "href"].forEach((attr) => {
      try {
        item.removeAttribute(attr);
      } catch (e) {
        /* ignore */
      }
    });
    if (item.dataset) {
      delete item.dataset.testid;
      delete item.dataset.testId;
      item.dataset.empMenu = entry.id;
    }
    try {
      item.querySelectorAll("[class*='shortcut'], kbd, input").forEach((n) => n.remove());
    } catch (e) {
      /* ignore */
    }
    let textEl = null;
    try {
      textEl = item.querySelector("[class*='dropdown-menu-item__text']") || item.querySelector("[class*='__text']");
    } catch (e) {
      /* ignore */
    }
    if (textEl) textEl.textContent = entry.label;
    else this.replaceFirstText(item, entry.label, doc);
    try {
      const iconEl = item.querySelector("[class*='icon']");
      if (iconEl) iconEl.innerHTML = ICON_MIRROR;
    } catch (e) {
      /* ignore */
    }
    item.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    item.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.closeExcalidrawMenus();
      try {
        entry.action();
      } catch (e) {
        console.error("Excalidraw Mirror: menu action failed", e);
      }
    });
    return item;
  }
  replaceFirstText(root, value, doc) {
    const d = doc || root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!d || !d.createTreeWalker || typeof NodeFilter === "undefined") {
      root.textContent = value;
      return;
    }
    const walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let first = true;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      if (first) {
        node.nodeValue = value;
        first = false;
      } else {
        node.nodeValue = "";
      }
    }
  }
  getMenuEntries() {
    return [
      { id: "toggle", label: "Mirror guide: add / remove all", action: () => this.cmdToggleMirrorMode() },
      { id: "another90", label: "Mirror guide: add another perpendicular (90°)", action: () => this.cmdAddAnotherGuide(null, 90) },
      { id: "another45", label: "Mirror guide: add another at 45°", action: () => this.cmdAddAnotherGuide(null, 45) },
      { id: "center", label: "Mirror guide: center on selection", action: () => this.cmdCenterGuide() },
      { id: "rotate45", label: "Mirror guide: rotate 45°", action: () => this.cmdRotateGuide(45) },
      { id: "reset", label: "Mirror guide: reset to vertical", action: () => this.cmdResetGuide() },
    ];
  }
  closeExcalidrawMenus() {
    for (const view of this.getExcalidrawViews()) {
      try {
        view.updateScene({ appState: { openMenu: null }, captureUpdate: "NEVER" });
      } catch (e) {
        /* ignore */
      }
    }
    if (typeof document !== "undefined" && document.dispatchEvent) {
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      } catch (e) {
        /* ignore */
      }
    }
  }

  // Toolbar

  attachToolbar(view) {
    if (this.toolbars.has(view)) return;
    const host = view.excalidrawContainer;
    if (!host || typeof document === "undefined") return;
    const el = document.createElement("div");
    el.className = "emp-toolbar";
    el.setAttribute("role", "toolbar");
    el.setAttribute("aria-label", "Excalidraw Mirror");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emp-button";
    button.title = "Mirror guide: add / remove";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = ICON_MIRROR;
    button.addEventListener("pointerdown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    button.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.cmdToggleMirrorMode(view);
    });
    el.appendChild(button);
    host.appendChild(el);
    this.toolbars.set(view, { el, modeBtn: button });
  }
  removeToolbar(view) {
    const rec = this.toolbars.get(view);
    if (!rec) return;
    rec.el.remove();
    this.toolbars.delete(view);
  }
  updateToolbar(view) {
    const rec = this.toolbars.get(view);
    if (!rec) return;
    rec.modeBtn.classList.toggle("is-active", this.findGuides(view).length > 0);
  }

  async setSetting(key, value) {
    this.settings[key] = value;
    await this.saveSettings();
    this.syncViews();
  }
}

class ExcalidrawMirrorPluginSettingTab extends PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Add actions to Excalidraw's menu")
      .setDesc("Adds the Mirror guide actions to Excalidraw's main menu, right after the Laser pointer item.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.menuIntegration).onChange((value) => this.plugin.setSetting("menuIntegration", value))
      );

    new Setting(containerEl)
      .setName("Show floating toolbar")
      .setDesc("Also show a small floating Mirror button in the Excalidraw view.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showToolbar).onChange((value) => this.plugin.setSetting("showToolbar", value))
      );

    new Setting(containerEl)
      .setName("Undo behavior")
      .setDesc(
        "What Ctrl+Z removes first. \"Remove both\" undoes the mirrored copy together with the stroke that created it; \"Mirror first\" removes only the mirrored copy first, so the next undo removes the original."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("both", "Remove both (default)")
          .addOption("mirrorFirst", "Remove mirrored copy first")
          .setValue(this.plugin.settings.undoMode)
          .onChange((value) => this.plugin.setSetting("undoMode", value))
      );

    containerEl.createEl("h4", { text: "Hotkeys" });
    containerEl.createEl("p", {
      text: 'All actions are available as commands: search "Mirror guide" under Settings -> Hotkeys to bind keys.',
      cls: "setting-item-description",
    });
    containerEl.createEl("h4", { text: "Tips" });
    containerEl.createEl("p", {
      text: "Ctrl+Click an existing element with the selection tool to mirror it across the guides. Add multiple guides with \"add another at 45°\" for radial symmetry (2 perpendicular guides give 4 mirrored sectors).",
      cls: "setting-item-description",
    });
  }
}

module.exports = ExcalidrawMirrorPlugin;
module.exports.__core = {
  reflectionMatrix,
  composeMatrices,
  applyMatrix,
  transformVector,
  matrixDeterminant,
  matricesClose,
  computeTransforms,
  transformElement,
  isMirrorGuide,
  isGuideLabel,
  isMirrorClone,
  getBoundingBox,
  guideAngleDegrees,
  guideEndpoints,
  guideCenter,
  hitTestElement,
  hitTestElements,
  randomId,
};
