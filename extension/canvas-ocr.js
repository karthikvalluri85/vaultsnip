(function() {
  "use strict";
  const toCss = (b, m) => ({ x: b.x * m.scale + m.offX, y: b.y * m.scale + m.offY, w: b.w * m.scale, h: b.h * m.scale });
  function cropForCanvas(rect, viewport, ratio) {
    const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
    const x1 = Math.min(viewport.w, rect.x + rect.w), y1 = Math.min(viewport.h, rect.y + rect.h);
    if (x1 - x0 < 8 || y1 - y0 < 8) return null;
    const crop = { x: Math.floor(x0 * ratio), y: Math.floor(y0 * ratio), w: Math.ceil((x1 - x0) * ratio), h: Math.ceil((y1 - y0) * ratio) };
    return { crop, map: { scale: 1 / ratio, offX: crop.x / ratio - rect.x, offY: crop.y / ratio - rect.y } };
  }
  function uncovered(found, masks) {
    return found.filter((f) => {
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      return !masks.some((m) => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h);
    });
  }
  function pixelDelta(a, b) {
    if (a.length !== b.length) return 255;
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return a.length ? d / a.length : 0;
  }
  const KEY = "__vaultsnipCanvas";
  const MIN_W = 40, MIN_H = 20;
  const WATCH_MS = 1500;
  const send = (msg) => chrome.runtime.sendMessage(msg);
  function allCanvases(root, out = []) {
    root.querySelectorAll("canvas").forEach((c) => out.push(c));
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) allCanvases(el.shadowRoot, out);
    });
    return out;
  }
  function visibleRect(c) {
    const r = c.getBoundingClientRect();
    if (r.width < MIN_W || r.height < MIN_H) return null;
    const s = getComputedStyle(c);
    if (s.visibility === "hidden" || s.display === "none" || +s.opacity === 0) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  function loadImage(dataUrl) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("image"));
      i.src = dataUrl;
    });
  }
  function signature(c) {
    try {
      const t = document.createElement("canvas");
      t.width = 32;
      t.height = 32;
      const ctx = t.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(c, 0, 0, 32, 32);
      return ctx.getImageData(0, 0, 32, 32).data;
    } catch {
      return null;
    }
  }
  function ownPixels(c) {
    try {
      const sig = signature(c);
      if (!sig || !sig.some((v, i) => i % 4 === 3 && v > 0)) return null;
      return c.toDataURL("image/png");
    } catch {
      return null;
    }
  }
  function paint(t) {
    const r = t.canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const o = t.overlay;
    o.width = Math.max(1, Math.round(r.width * dpr));
    o.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = o.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const tiny = document.createElement("canvas");
    const tctx = tiny.getContext("2d");
    for (const { box, img, map } of t.masks) {
      const sx = (box.x - map.offX) / map.scale, sy = (box.y - map.offY) / map.scale;
      const sw = box.w / map.scale, sh = box.h / map.scale;
      tiny.width = Math.max(1, Math.round(box.w / 12));
      tiny.height = Math.max(1, Math.round(box.h / 12));
      tctx.imageSmoothingQuality = "high";
      tctx.drawImage(img, sx, sy, sw, sh, 0, 0, tiny.width, tiny.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
      ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, box.x, box.y, box.w, box.h);
      ctx.filter = `blur(${Math.max(2, Math.min(box.h, box.w) / 4)}px)`;
      ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, box.x - 4, box.y - 4, box.w + 8, box.h + 8);
      ctx.restore();
    }
  }
  function start() {
    const host = document.createElement("vaultsnip-redactions");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;";
    const shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
    const badge = document.createElement("div");
    badge.style.cssText = "position:fixed;right:12px;bottom:12px;font:12px/1.4 system-ui,sans-serif;background:#14181e;color:#fff;padding:6px 10px;border-radius:6px;opacity:.92;";
    shadow.appendChild(badge);
    const say = (s) => {
      badge.textContent = `VaultSnip: ${s}`;
    };
    const targets = /* @__PURE__ */ new Map();
    let stopped = false;
    async function snapshot(cs) {
      const shots = [];
      const needTab = [];
      for (const c of cs) {
        const url = ownPixels(c);
        const r = c.getBoundingClientRect();
        if (url) shots.push({ c, image: { id: String(shots.length), dataUrl: url }, map: { scale: r.width / c.width, offX: 0, offY: 0 }, fromTab: false });
        else needTab.push(c);
      }
      if (needTab.length) shots.push(...await fromTab(needTab, shots.length));
      return shots;
    }
    async function fromTab(cs, idBase) {
      const out = [];
      badge.style.visibility = "hidden";
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      let cap;
      try {
        cap = await send({ type: "vs-canvas-capture" });
      } finally {
        badge.style.visibility = "";
      }
      if (!cap.ok) throw new Error(cap.error);
      const shot = await loadImage(cap.dataUrl);
      const ratio = shot.naturalWidth / innerWidth;
      for (const c of cs) {
        const r = visibleRect(c);
        const cut = r && cropForCanvas(r, { w: innerWidth, h: innerHeight }, ratio);
        if (!cut) continue;
        const t = document.createElement("canvas");
        t.width = cut.crop.w;
        t.height = cut.crop.h;
        t.getContext("2d").drawImage(shot, cut.crop.x, cut.crop.y, cut.crop.w, cut.crop.h, 0, 0, cut.crop.w, cut.crop.h);
        out.push({ c, image: { id: String(idBase + out.length), dataUrl: t.toDataURL("image/png") }, map: cut.map, fromTab: true });
      }
      return out;
    }
    async function ocr(images) {
      const r = await send({ type: "vs-canvas-ocr", images });
      if (!r.ok) throw new Error(r.error);
      return new Map(r.results.map((x) => [x.id, x]));
    }
    function target(c) {
      let t = targets.get(c);
      if (!t) {
        const overlay = document.createElement("canvas");
        overlay.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;";
        shadow.insertBefore(overlay, badge);
        const r = c.getBoundingClientRect();
        t = { canvas: c, overlay, masks: [], size: { w: r.width, h: r.height }, signature: null, busy: false };
        targets.set(c, t);
      }
      return t;
    }
    async function scan(cs) {
      const todo = cs.filter((c) => !targets.get(c)?.busy);
      todo.forEach((c) => {
        target(c).busy = true;
      });
      try {
        const shots = await snapshot(todo);
        if (!shots.length) return 0;
        const results = await ocr(shots.map((s) => s.image));
        let n = 0;
        for (const s of shots) {
          const t = target(s.c);
          const img = await loadImage(s.image.dataUrl);
          const found = (results.get(s.image.id)?.boxes ?? []).map((b) => ({ box: toCss(b, s.map), img, map: s.map }));
          t.masks = s.fromTab && t.masks.length ? [...t.masks, ...found.filter((f) => uncovered([f.box], t.masks.map((m) => m.box)).length)] : found;
          const r = s.c.getBoundingClientRect();
          t.size = { w: r.width, h: r.height };
          t.signature = signature(s.c);
          paint(t);
          n += t.masks.length;
        }
        return n;
      } finally {
        todo.forEach((c) => {
          const t = targets.get(c);
          if (t) t.busy = false;
        });
      }
    }
    async function verify() {
      const list = [...targets.values()].filter((t) => visibleRect(t.canvas));
      if (!list.length) return 0;
      const shots = await fromTab(list.map((t) => t.canvas), 0);
      const results = await ocr(shots.map((s) => s.image));
      let added = 0;
      for (const s of shots) {
        const t = targets.get(s.c);
        const found = (results.get(s.image.id)?.boxes ?? []).map((b) => toCss(b, s.map));
        const missed = uncovered(found, t.masks.map((m) => m.box));
        if (!missed.length) continue;
        const img = await loadImage(s.image.dataUrl);
        t.masks.push(...missed.map((box) => ({ box, img, map: s.map })));
        paint(t);
        added += missed.length;
      }
      return added;
    }
    const follow = () => {
      if (stopped) return;
      const resized = [];
      for (const t of targets.values()) {
        const r = t.canvas.getBoundingClientRect();
        const shown = r.width >= MIN_W && r.height >= MIN_H && t.canvas.isConnected;
        t.overlay.style.display = shown ? "" : "none";
        t.overlay.style.transform = `translate(${r.left}px,${r.top}px)`;
        t.overlay.style.width = `${r.width}px`;
        t.overlay.style.height = `${r.height}px`;
        if (shown && (Math.abs(r.width - t.size.w) > 1 || Math.abs(r.height - t.size.h) > 1)) resized.push(t.canvas);
      }
      if (resized.length) void scan(resized).catch(() => {
      });
      requestAnimationFrame(follow);
    };
    const watch = setInterval(() => {
      const redrawn = [...targets.values()].filter((t) => {
        if (t.busy || !t.signature) return false;
        const now = signature(t.canvas);
        return !!now && pixelDelta(now, t.signature) > 2;
      });
      if (redrawn.length) void scan(redrawn.map((t) => t.canvas)).catch(() => {
      });
    }, WATCH_MS);
    (async () => {
      const cs = allCanvases(document).filter((c) => visibleRect(c));
      if (!cs.length) return say("no charts drawn on canvas on this page.");
      say(`reading text in ${cs.length} chart${cs.length > 1 ? "s" : ""} on this device…`);
      requestAnimationFrame(follow);
      const n = await scan(cs);
      say("checking again…");
      const extra = await verify();
      say(`blurred ${n + extra} item${n + extra === 1 ? "" : "s"} in ${cs.length} chart${cs.length > 1 ? "s" : ""}. Run again to remove.`);
      host.dataset.state = "done";
      host.dataset.masks = String(n + extra);
      host.dataset.verifyAdded = String(extra);
    })().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      say(`could not read the charts: ${msg}`);
      host.dataset.state = "error";
      host.dataset.error = msg;
    });
    return {
      stop() {
        stopped = true;
        clearInterval(watch);
        host.remove();
      }
    };
  }
  function toggle() {
    const w = window;
    const prev = w[KEY];
    if (prev) {
      prev.stop();
      w[KEY] = void 0;
    } else {
      w[KEY] = start();
    }
  }
  toggle();
})();
