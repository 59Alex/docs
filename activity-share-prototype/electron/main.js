// Прототип «Connect Активность» (Electron): встроенный браузер, выбор и «съедание» плеера,
// захват вида сайта (setDisplayMediaRequestHandler + WebFrameMain), публикация участником #activity в LiveKit, замеры у зрителей.
const { app, BaseWindow, BrowserWindow, WebContentsView, session, ipcMain, screen } = require("electron");
const fs = require("fs"); const path = require("path"); const crypto = require("crypto");
const BASE = "http://127.0.0.1:" + (process.env.PORT || 8790); const LKURL = process.env.LKURL || "ws://127.0.0.1:7880";
const PLAN = JSON.parse(fs.readFileSync(process.env.PLAN || path.join(__dirname, "plan.json")));
const OUT = process.env.OUT || path.join(__dirname, "results-electron.jsonl"); const SHOTS = process.env.SHOTS || path.join(__dirname, "shots");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
for (const sw of (process.env.SWITCHES || "").split(",").filter(Boolean)) app.commandLine.appendSwitch(sw);
if (process.env.FEATURES) app.commandLine.appendSwitch("enable-features", process.env.FEATURES);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (name, step, data) => { const o = { t: new Date().toISOString(), name, step, data }; fs.appendFileSync(OUT, JSON.stringify(o) + "\n"); console.log(o.t.slice(11, 19), name, step, JSON.stringify(data).slice(0, 600)); };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
let pending = new Map();
ipcMain.on("actshare:reply", (e, m) => { const p = pending.get(m.id); if (p) p.push({ frame: e.senderFrame, url: e.senderFrame && e.senderFrame.url, res: m.res }); });
async function cmdFrames(frames, msg, wait = 1500) { const id = crypto.randomUUID(); const acc = []; pending.set(id, acc);
  for (const f of frames) { try { f.send("actshare:cmd", { ...msg, id }); } catch (e) {} }
  const t0 = Date.now(); while (acc.length < frames.length && Date.now() - t0 < wait) await sleep(50); pending.delete(id); return acc; }
async function runCase(c) {
  const N = c.name; const W = 1300, H = 900;
  const win = new BaseWindow({ width: W, height: H, x: 70, y: 40, title: "Connect Активность" });
  const sitesSes = session.fromPartition("persist:sites" + (c.webSecurity === false ? "-nows" : ""));
  await sitesSes.setProxy({ pacScript: BASE + "/pac.js" });
  sitesSes.setPermissionRequestHandler((_wc, perm, cb) => cb(false)); // сайтам — никаких разрешений (камера, микрофон, уведомления…)
  const appSes = session.fromPartition("persist:connect-app");
  const preload = path.join(__dirname, "site-preload.js");
  const siteView = new WebContentsView({ webPreferences: { session: sitesSes, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true, preload, backgroundThrottling: false, webSecurity: c.webSecurity !== false } });
  const appView = new WebContentsView({ webPreferences: { session: appSes, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  appSes.setPermissionRequestHandler((_wc, perm, cb) => cb(["media", "display-capture"].includes(perm)));
  appSes.setDisplayMediaRequestHandler((_req, cb) => cb({ video: siteView.webContents.mainFrame, audio: c.noAudio ? undefined : siteView.webContents.mainFrame }));
  siteView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.contentView.addChildView(siteView); win.contentView.addChildView(appView);
  appView.setBounds({ x: 0, y: 0, width: W, height: 50 }); siteView.setBounds({ x: 0, y: 50, width: W, height: H - 50 });
  await appView.webContents.loadURL(BASE + "/app.html");
  await siteView.webContents.loadURL(c.url.startsWith("http") ? c.url : BASE + c.url).catch((e) => report(N, "load-error", String(e)));
  await sleep(c.warm || 6000);
  const secret = crypto.randomUUID(); const frames = siteView.webContents.mainFrame.framesInSubtree;
  const scans = await cmdFrames(frames, { op: "scan", secret });
  const all = []; for (const s of scans) for (const p of (s.res && s.res.players) || []) all.push({ ...p, frame: s.frame, url: s.url });
  report(N, "scan", { frames: frames.length, framesAnswered: scans.length, players: all.map(({ frame, ...p }) => ({ ...p, url: p.url.slice(0, 80) })) });
  if (!all.length) { win.destroy(); try { siteView.webContents.close(); appView.webContents.close(); } catch {} return; }
  const pick = all.sort((a, b) => b.w * b.h - a.w * a.h)[0];
  await cmdFrames(frames, { op: "highlight", on: true }); await sleep(300);
  fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, N + "-1-highlight.png"), (await siteView.webContents.capturePage()).toPNG());
  await cmdFrames(frames, { op: "highlight", on: false });
  const ct = await cmdFrames([pick.frame], { op: "capture-test", i: pick.i }, 6000);
  report(N, "captureStream-in-page", { player: { tag: pick.tag, vw: pick.vw, vh: pick.vh, inFrame: pick.inFrame, src: pick.src }, webSecurity: c.webSecurity !== false, res: ct[0] && ct[0].res });
  // Положение плеера относительно вида (для iframe — прямоугольник iframe в верхнем кадре; для прототипа берём выбранный элемент верхнего кадра или весь iframe)
  const snap = await siteView.webContents.capturePage();
  const rect = pick.inFrame ? (all.find((p) => !p.inFrame) || { x: 0, y: 0, w: 1000, h: 640 }) : pick;
  await cmdFrames([pick.frame], { op: "eat", i: pick.i, secret }); await sleep(800);
  if (c.mode && c.mode.startsWith("hidden")) {
    // incrementCapturerCount в Electron 44 нет; захват сам держит страницу «видимой» для отрисовки.
    // Размер скрытого вида = размер захвата в физических пикселях (иначе снимается размер окна × масштаб экрана).
    const sf = screen.getPrimaryDisplay().scaleFactor; report(N, "scale", { scaleFactor: sf });
    const cw = Math.round((c.w || 1920) / sf), chh = Math.round((c.h || 1080) / sf);
    if (c.mode === "hidden") { siteView.setBounds({ x: 0, y: 0, width: cw, height: chh }); siteView.setVisible(false); }
    // covered: вид сайта остаётся «показанным», но целиком под окном приложения (z-порядок), размер = размер захвата
    if (c.mode === "hidden-covered") siteView.setBounds({ x: 0, y: 0, width: cw, height: chh });
    // outside: вид сайта за пределами окна (обрезан окном), размер = размер захвата
    if (c.mode === "hidden-outside") siteView.setBounds({ x: W + 50, y: 0, width: cw, height: chh });
    appView.setBounds({ x: 0, y: 0, width: W, height: H });
    await appView.webContents.executeJavaScript(`showEaten(${JSON.stringify(snap.toDataURL())}, ${JSON.stringify({ x: rect.x, y: rect.y, w: rect.w, h: rect.h })}, ${640 / W})`);
  }
  await sleep(500);
  const cfg = { fps: c.fps || 60, w: c.w || 1920, h: c.h || 1080 };
  const cap = await appView.webContents.executeJavaScript(`capture(${JSON.stringify(cfg)})`, true).catch((e) => ({ error: String(e) }));
  report(N, "frame-capture", { mode: c.mode, ...cap });
  fs.writeFileSync(path.join(SHOTS, N + "-2-app.png"), (await appView.webContents.capturePage()).toPNG());
  if (c.publish && !cap.error) {
    const room = "act-" + N + "-" + Date.now();
    const ok = await appView.webContents.executeJavaScript(`publish(${JSON.stringify({ ...cfg, room, url: LKURL, identity: "u1#activity", codec: c.codec, simulcast: c.simulcast, maxBitrate: c.maxBitrate, svc: c.svc, stream: c.stream })})`).catch((e) => ({ error: String(e) }));
    report(N, "publish", ok);
    const viewers = [];
    for (let i = 0; i < (c.viewers || 3); i++) {
      const disp = screen.getPrimaryDisplay().workArea;
      const pos = c.viewerPos === "aside" ? { x: disp.x + disp.width - 650, y: disp.y + i * 420 } : { x: 20 + i * 660, y: 40 };
      const vw = new BrowserWindow({ width: 640, height: 380, ...pos, title: "Зритель " + i, webPreferences: { partition: "viewer" + i, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
      await vw.loadURL(BASE + "/viewer.html"); viewers.push(vw);
      const r = await vw.webContents.executeJavaScript(`startViewer(${JSON.stringify({ room, url: LKURL, identity: i === 0 ? "u1" : "u" + (i + 1), jbt: c.jbt })})`).catch((e) => ({ error: String(e) }));
      report(N, "viewer" + i, r);
    }
    if (c.minimize) { win.minimize(); await sleep(1500); report(N, "minimized", { isMinimized: win.isMinimized() }); }
    app.getAppMetrics();
    const sstats = []; const t0 = Date.now(); let lastBytes = {};
    while (Date.now() - t0 < (c.seconds || 30) * 1000) {
      await sleep(2000);
      const ss = await appView.webContents.executeJavaScript("senderStats()").catch((e) => [{ error: String(e) }]);
      for (const r of ss) if (r.bytes != null) { const k = r.rid || "-"; r.kbps = lastBytes[k] ? Math.round((r.bytes - lastBytes[k].b) * 8 / (r.ts - lastBytes[k].t)) : null; lastBytes[k] = { b: r.bytes, t: r.ts }; }
      if (sstats.length % 3 === 0) report(N, "local-during-publish", { local: await appView.webContents.executeJavaScript("measureLocal(2000)").catch((e) => String(e)),
        pageRaf: await siteView.webContents.executeJavaScript("new Promise(r=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0<1000)requestAnimationFrame(f);else r({raf:n,vis:document.visibilityState})};requestAnimationFrame(f);setTimeout(()=>r({raf:n,vis:document.visibilityState,timeout:true}),3000)})").catch((e) => String(e)),
        cpu: app.getAppMetrics().map((m) => m.type + ":" + Math.round(m.cpu.percentCPUUsage)).join(" ") });
      sstats.push(ss); for (const vw of viewers) await vw.webContents.executeJavaScript("viewerStats()").catch(() => null);
    }
    const metrics = app.getAppMetrics().filter((m) => m.cpu.percentCPUUsage > 1).map((m) => ({ type: m.type, cpu: Math.round(m.cpu.percentCPUUsage), name: m.name, mem: Math.round(m.memory.workingSetSize / 1024) }));
    const col = []; for (const vw of viewers) col.push(await vw.webContents.executeJavaScript("collect()"));
    if (viewers[0]) fs.writeFileSync(path.join(SHOTS, N + "-3-viewer.png"), (await viewers[0].webContents.capturePage()).toPNG());
    // Сводка: задержка «отрисовка на сайте → показ у зрителя», разброс между зрителями, звук.
    const skip = (fr) => { const st = fr.length ? fr[0][1] + 5000 : 0; return fr.filter((f) => f[1] > st); };
    const per = col.map((v, i) => { const fr = skip(v.frames); const lat = fr.map((f) => f[1] - f[0]);
      const dur = fr.length > 1 ? (fr[fr.length - 1][1] - fr[0][1]) / 1000 : 0;
      const aud = v.onsets.slice(2).map((o) => o - Math.round(o / 1000) * 1000);
      const st = v.stats.slice(-3); const last = v.stats[v.stats.length - 1] || {};
      return { viewer: i, frames: fr.length, fps: dur ? +(fr.length / dur).toFixed(1) : null, res: fr.length ? fr[fr.length - 1][2] + "x" + fr[fr.length - 1][3] : null,
        latP50: pct(lat, 50), latP95: pct(lat, 95), latMax: pct(lat, 100), audioLatP50: pct(aud, 50), audioN: aud.length, avOffsetP50: pct(aud, 50) != null && pct(lat, 50) != null ? pct(aud, 50) - pct(lat, 50) : null,
        statFps: last.fps, statRes: last.w ? last.w + "x" + last.h : null, kbpsIn: v.stats.length > 2 && last.bytes ? Math.round((last.bytes - v.stats[v.stats.length - 3].bytes) * 8 / 4000) : null,
        jb: last.jb, aJb: last.aJb, dec: last.dec, codec: last.codec, dropped: last.dropped, lost: last.lost, decoded: last.decoded, aConcealed: last.aConcealed, aSamples: last.aSamples }; });
    const maps = col.map((v) => new Map(skip(v.frames).map((f) => [f[0], f[1]]))); const spread = [];
    if (maps.length) for (const [ts] of maps[0]) { const d = maps.map((m) => m.get(ts)); if (d.every((x) => x != null)) spread.push(Math.max(...d) - Math.min(...d)); }
    report(N, "summary", { codec: c.codec, mode: c.mode, viewers: per, spreadP50: pct(spread, 50), spreadP95: pct(spread, 95), spreadN: spread.length, sender: sstats[sstats.length - 1], senderSeries: sstats.map((s) => s.filter((r) => r.kbps != null).map((r) => [r.rid, r.w, r.h, r.fps, r.kbps, r.enc, r.ql])), metrics });
    for (const vw of viewers) { await vw.webContents.executeJavaScript("stopViewer()").catch(() => {}); vw.destroy(); }
  }
  // Проверка управления: пауза/воспроизведение выбранного плеера через тот же канал команд
  if (pick.tag === "video") { await cmdFrames([pick.frame], { op: "cmd", kind: "PAUSE" }); await sleep(500); const s1 = await cmdFrames([pick.frame], { op: "state" });
    await cmdFrames([pick.frame], { op: "cmd", kind: "PLAY" }); await sleep(800); const s2 = await cmdFrames([pick.frame], { op: "state" });
    report(N, "control", { afterPause: s1[0] && s1[0].res, afterPlay: s2[0] && s2[0].res }); }
  await appView.webContents.executeJavaScript("stop()").catch(() => {});
  win.destroy(); try { siteView.webContents.close(); appView.webContents.close(); } catch {} await sleep(1000);
}
app.whenReady().then(async () => {
  const gi = await app.getGPUInfo("basic").catch(() => null);
  report("run", "start", { gpuInfo: gi && gi.gpuDevice, display: screen.getPrimaryDisplay().workArea, switches: process.env.SWITCHES || null, electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, features: process.env.FEATURES || null, gpu: app.getGPUFeatureStatus() });
  for (const c of PLAN.cases) { try { await runCase(c); } catch (e) { report(c.name, "error", String(e && e.stack || e)); } }
  report("run", "DONE", {}); app.quit();
});
app.on("window-all-closed", () => {});
