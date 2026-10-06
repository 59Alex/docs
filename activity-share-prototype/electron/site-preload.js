// Preload встроенного браузера (аналог content script): работает в каждом кадре сайта (nodeIntegrationInSubFrames),
// в изолированном мире (contextIsolation), в песочнице. Ищет плееры, подсвечивает, «съедает», проверяет captureStream().
const { ipcRenderer } = require("electron");
let secret = null; let chosen = null;
function deepAll(root, sel, out = []) {
  root.querySelectorAll(sel).forEach((e) => out.push(e));
  root.querySelectorAll("*").forEach((e) => { if (e.shadowRoot) deepAll(e.shadowRoot, sel, out); });
  return out;
}
function players() {
  return deepAll(document, "video, canvas[data-player]").map((el, i) => {
    const r = el.getBoundingClientRect();
    return { i, tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top),
      vw: el.videoWidth || el.width, vh: el.videoHeight || el.height, paused: el.paused, muted: el.muted,
      drm: !!el.mediaKeys, src: el.currentSrc ? el.currentSrc.slice(0, 5) : (el.srcObject ? "srcObject" : ""), inFrame: window !== window.top };
  }).filter((p) => p.w * p.h > 10000);
}
function highlight(on) {
  document.querySelectorAll("[data-actshare-hl]").forEach((e) => e.remove());
  if (!on) return;
  for (const p of players()) {
    const d = document.createElement("div"); d.setAttribute("data-actshare-hl", "");
    d.style.cssText = `position:fixed;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;outline:4px solid #4f8cff;background:rgba(79,140,255,.18);z-index:2147483647;pointer-events:none;font:bold 18px sans-serif;color:#fff`;
    d.textContent = p.drm ? "Защищено — нельзя" : "Выбрать плеер";
    document.documentElement.appendChild(d);
  }
}
async function measureTrack(track, ms) {
  if (!track || !window.MediaStreamTrackProcessor) return { note: "no MSTP" };
  const r = new MediaStreamTrackProcessor({ track }).readable.getReader(); let n = 0, w = 0, h = 0; const t0 = performance.now();
  while (performance.now() - t0 < ms) { const { value, done } = await r.read(); if (done) break; n++; w = value.displayWidth; h = value.displayHeight; value.close(); }
  r.releaseLock(); return { fps: +(n * 1000 / (performance.now() - t0)).toFixed(1), w, h };
}
async function captureTest(el) {
  try {
    const s = el.tagName === "VIDEO" ? el.captureStream() : el.captureStream(60);
    const v = s.getVideoTracks()[0]; const a = s.getAudioTracks();
    const m = await measureTrack(v, 3000); s.getTracks().forEach((t) => t.stop());
    return { ok: true, video: !!v, audio: a.length, ...m };
  } catch (e) { return { ok: false, error: e.name + ": " + e.message }; }
}
function cinema(el) {
  // «Съесть»: элемент на весь вид, чёрный фон, остальное под ним; сам вид будет скрыт и снят целиком.
  el.style.setProperty("position", "fixed", "important"); el.style.setProperty("inset", "0", "important");
  el.style.setProperty("width", "100vw", "important"); el.style.setProperty("height", "100vh", "important");
  el.style.setProperty("z-index", "2147483646", "important"); el.style.setProperty("object-fit", "contain", "important");
  el.style.setProperty("background", "#000", "important"); el.style.setProperty("max-width", "none", "important");
  document.documentElement.style.setProperty("overflow", "hidden", "important");
  if (el.tagName === "VIDEO") { el.controls = false; if (el.paused) el.play().catch(() => {}); }
  if (window !== window.top) window.parent.postMessage({ __actshare: secret, op: "expand" }, "*");
}
window.addEventListener("message", (e) => {
  if (!e.data || e.data.__actshare !== secret || !secret || e.data.op !== "expand") return;
  for (const f of document.querySelectorAll("iframe")) if (f.contentWindow === e.source) { cinema(f); break; }
});
ipcRenderer.on("actshare:cmd", async (_e, m) => {
  if (m.secret) secret = m.secret;
  let res = null;
  if (m.op === "scan") res = { url: location.href, players: players() };
  else if (m.op === "highlight") { highlight(m.on); res = true; }
  else if (m.op === "capture-test") { const el = deepAll(document, "video, canvas[data-player]")[m.i]; res = el ? await captureTest(el) : { ok: false, error: "no element" }; }
  else if (m.op === "eat") { highlight(false); chosen = deepAll(document, "video, canvas[data-player]")[m.i]; if (chosen) { if (chosen.tagName === "VIDEO") chosen.muted = false; cinema(chosen); } res = !!chosen; }
  else if (m.op === "state") { const v = chosen; res = v && v.tagName === "VIDEO" ? { t: v.currentTime, paused: v.paused, vw: v.videoWidth, vh: v.videoHeight, rate: v.playbackRate, q: v.getVideoPlaybackQuality && v.getVideoPlaybackQuality() } : null; }
  else if (m.op === "cmd") { const v = chosen; if (v && v.tagName === "VIDEO") { if (m.kind === "PAUSE") v.pause(); if (m.kind === "PLAY") await v.play().catch(() => {}); if (m.kind === "SEEK") v.currentTime = m.t; } res = true; }
  ipcRenderer.send("actshare:reply", { id: m.id, res });
});
