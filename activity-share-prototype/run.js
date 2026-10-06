// Прототип T133: «расширение съедает плеер». Запуск: node run.js chromium|firefox|webkit [site,...]
process.env.NODE_PATH = "/home/aleksandr/mnt/work/da4-pw/node_modules"; require("module").Module._initPaths();
const pw = require("playwright"); const fs = require("fs"); const path = require("path");
require("./server.js");
const LIB = fs.readFileSync(path.join(__dirname, "ext/probe-lib.js"), "utf8");
const PAC = `function FindProxyForURL(url, host) {
  var d = ["localhost","127.0.0.1",".ru",".vk.com","vk.com",".userapi.com",".vkuser.net",".mycdn.me",".okcdn.ru",".vk-cdn.net",".rtbcdn.ru",".mail.ru",".yandex.net"];
  for (var i = 0; i < d.length; i++) { if (host === d[i] || (d[i][0] === "." && dnsDomainIs(host, d[i]))) return "DIRECT"; }
  return "SOCKS5 127.0.0.1:10808"; }`;
const PACURL = "data:application/x-ns-proxy-autoconfig;base64," + Buffer.from(PAC).toString("base64");
const engine = process.argv[2] || "chromium";
const only = (process.argv[3] || "").split(",").filter(Boolean);
const L = "http://localhost:8099";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function ytConsent(page) { for (const t of [/Accept all/i, /Reject all/i, /Принять все/i, /Отклонить все/i]) { const b = page.getByRole("button", { name: t }).first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await sleep(2000); return; } } }
async function firstLink(page, re) { const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href)); return hrefs.find((h) => re.test(h)); }

const SITES = {
  youtube: { url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", prep: ytConsent },
  "youtube-embed": { url: L + "/iframe-yt.html", frame: /youtube\.com\/embed/ },
  vk: { url: "https://vkvideo.ru/", prep: async (p) => { await sleep(4000); const h = await firstLink(p, /vkvideo\.ru\/video-?\d+_\d+/); if (!h) throw new Error("vk: нет ссылки"); log("vk ->", h); await p.goto(h, { waitUntil: "domcontentloaded" }); await sleep(3000); } },
  rutube: { url: "https://rutube.ru/", prep: async (p, ctxState) => { await sleep(4000); const h = await firstLink(p, /rutube\.ru\/video\/[0-9a-f]{32}/); if (!h) throw new Error("rutube: нет ссылки"); ctxState.rtid = h.match(/[0-9a-f]{32}/)[0]; log("rutube ->", h); await p.goto(h, { waitUntil: "domcontentloaded" }); await sleep(3000); } },
  "rutube-embed": { url: null, frame: /rutube\.ru\/play\/embed/ },
  twitch: { url: "https://www.twitch.tv/", prep: async () => { await sleep(6000); } },
  hls: { url: "https://hlsjs.video-dev.org/demo/?src=" + encodeURIComponent("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8") },
  "hls-iframe": { url: L + "/iframe-hls.html", frame: /hlsjs\.video-dev\.org/ },
  nocors: { url: L + "/nocors.html" },
  cors: { url: L + "/cors.html" },
};

async function send(frame, c, viaExt) {
  if (!viaExt) { await frame.evaluate(LIB); return frame.evaluate((c) => window.__actProbe(c), c); }
  return frame.evaluate((c) => new Promise((res) => { const id = Math.random().toString(36).slice(2);
    const h = (e) => { if (e.data && e.data.__act === "res" && e.data.id === id) { removeEventListener("message", h); res(e.data.r); } };
    addEventListener("message", h); postMessage({ __act: "req", id, c }, "*"); setTimeout(() => res({ error: "timeout content script" }), 120000); }), c);
}

(async () => {
  let ctx, extId = null; const viaExt = engine === "chromium";
  const args = ["--autoplay-policy=no-user-gesture-required"];
  if (engine === "chromium") {
    const ud = path.join(__dirname, ".profile-chromium"); fs.rmSync(ud, { recursive: true, force: true });
    ctx = await pw.chromium.launchPersistentContext(ud, { channel: "chromium", headless: !process.env.HEADED, ignoreDefaultArgs: process.env.REALBG ? ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"] : [], viewport: { width: 1280, height: 800 },
      args: [...args, "--proxy-pac-url=" + PACURL, "--disable-extensions-except=" + path.join(__dirname, "ext"), "--load-extension=" + path.join(__dirname, "ext")] });
    let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 }); extId = sw.url().split("/")[2];
    log("chromium", ctx.browser() ? "" : "", "ext", extId);
  } else {
    const prefs = { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0, "network.proxy.type": 2, "network.proxy.autoconfig_url": PACURL, "network.proxy.socks_remote_dns": true };
    const b = await pw[engine].launch({ headless: true, ...(process.env.BPATH ? { executablePath: process.env.BPATH } : {}), ...(engine === "firefox" ? { firefoxUserPrefs: prefs } : {}) });
    ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ...(engine === "webkit" ? { proxy: { server: "socks5://127.0.0.1:10808", bypass: "localhost,127.0.0.1,.ru,.vk.com,.userapi.com,.vkuser.net,.mycdn.me,.okcdn.ru" } } : {}) });
  }
  const state = {}; const results = {};
  const names = only.length ? only : Object.keys(SITES);
  for (const name of names) {
    const s = SITES[name]; if (!s) continue; let url = s.url;
    if (name === "rutube-embed") { if (!state.rtid) { log("skip rutube-embed: нет id"); continue; } url = L + "/iframe-rt.html?id=" + state.rtid; }
    const page = await ctx.newPage(); const r = { name };
    try {
      log("==", name, url); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      if (s.prep) await s.prep(page, state);
      await sleep(3000);
      let frame = page.mainFrame();
      if (s.frame) { for (let i = 0; i < 20 && !page.frames().find((f) => s.frame.test(f.url())); i++) await sleep(1000); frame = page.frames().find((f) => s.frame.test(f.url())) || frame; r.frameUrl = frame.url().slice(0, 100); }
      r.probe = await send(frame, { cmd: "probe" }, viaExt);
      log(name, JSON.stringify(r.probe.info));
      for (const x of r.probe.res || []) log("  ", x.label, x.vis, "play", x.playing, "adv", x.advanced, "V", JSON.stringify(x.video), "A", JSON.stringify(x.audio));
      if (r.probe.res) {
        // «Вкладка Connect» в переднем плане, сайт уходит в фон; плеер съеден и заглушён
        let B;
        if (engine === "chromium") { const cdp = await ctx.newCDPSession(page); const pp = ctx.waitForEvent("page"); await cdp.send("Target.createTarget", { url: L + "/connect.html", newWindow: false, background: false }); B = await pp; await B.waitForLoadState(); }
        else { B = await ctx.newPage(); await B.goto(L + "/connect.html"); await B.bringToFront(); }
        log("   site tab visibility after Connect tab opened:", await frame.evaluate(() => document.visibilityState), "B:", await B.evaluate(() => document.visibilityState));
        await sleep(4000);
        r.bg = await send(frame, { cmd: "sample", label: "background(eaten+muted)", ms: 3000 }, viaExt);
        log("  ", r.bg.label, r.bg.vis, "play", r.bg.playing, "adv", r.bg.advanced, "V", JSON.stringify(r.bg.video), "A", JSON.stringify(r.bg.audio));
        const off = await send(frame, { cmd: "pc-offer" }, viaExt);
        if (off.sdp) { const ans = await B.evaluate((sdp) => window.recv(sdp), off.sdp); await send(frame, { cmd: "pc-answer", sdp: ans }, viaExt);
          await sleep(20000); r.loopRecv = await B.evaluate(() => window.stats()); r.loopSend = await send(frame, { cmd: "pc-stats" }, viaExt);
          log("   loopback recv", JSON.stringify(r.loopRecv), "send", JSON.stringify(r.loopSend)); } else log("   pc-offer", JSON.stringify(off));
        if (extId && !state.helloDone) { state.helloDone = 1; r.hello = await B.evaluate((id) => window.hello(id), extId); log("   externally_connectable hello", JSON.stringify(r.hello)); }
        await B.close();
      }
    } catch (e) { r.error = String(e.message || e).slice(0, 300); log(name, "ERROR", r.error); }
    results[name] = r; await page.close().catch(() => {});
  }
  if (names.includes("csp") || !only.length) {
    const p = await ctx.newPage(); await p.goto(L + "/csp.html"); await sleep(1000);
    const iso = viaExt ? await send(p.mainFrame(), { cmd: "ws-test", url: "ws://127.0.0.1:8100/" }, true) : null;
    const isoF = viaExt ? await send(p.mainFrame(), { cmd: "fetch-test", url: "https://www.google.com/generate_204" }, true) : null;
    const main = await p.evaluate(() => new Promise((r) => { try { const w = new WebSocket("ws://127.0.0.1:8100/"); w.onopen = () => r("open"); w.onerror = () => r("error"); } catch (e) { r("throw:" + e.name); } setTimeout(() => r("timeout"), 4000); }));
    results.csp = { isolatedWs: iso, isolatedFetch: isoF, mainWs: main }; log("CSP connect-src self:", JSON.stringify(results.csp)); await p.close();
  }
  fs.writeFileSync(path.join(__dirname, `results-${engine}.json`), JSON.stringify(results, null, 1));
  await ctx.close(); process.exit(0);
})();
