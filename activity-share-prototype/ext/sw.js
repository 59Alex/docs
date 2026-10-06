// Оркестратор реального прогона (без Playwright): вкладки, фон, loopback — всё силами расширения.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "hello") sendResponse({ ok: true, version: chrome.runtime.getManifest().version, origin: sender.origin, tab: sender.tab && sender.tab.id });
});
const BASE = "http://localhost:8099";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (name, step, data) => fetch(BASE + "/report", { method: "POST", body: JSON.stringify({ name, step, data }) }).catch(() => {});
setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
function waitComplete(tabId, ms = 40000) { return new Promise((res) => { const t = setTimeout(done, ms); function done() { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); res(); } function l(id, info) { if (id === tabId && info.status === "complete") done(); } chrome.tabs.onUpdated.addListener(l); }); }
const send = (tabId, c, frameId = 0) => Promise.race([chrome.tabs.sendMessage(tabId, { __actc: c }, { frameId }).catch((e) => ({ error: "sendMessage: " + e.message })), sleep(180000).then(() => ({ error: "timeout 180s " + c.cmd }))]);
let running = false;
async function run() {
  if (running) return; running = true;
  let plan; try { plan = await (await fetch(BASE + "/plan.json")).json(); } catch (e) { return; }
  if (!plan.sites) return;
  const st = {};
  for (const s of plan.sites) {
    let a, b;
    try {
      report(s.name, "start", s.url); let url = s.url; if (url.includes("{rtid}")) { if (!st.rtid) { report(s.name, "skip", "нет rtid"); continue; } url = url.replace("{rtid}", st.rtid); }
      a = await chrome.tabs.create({ url, active: true }); await waitComplete(a.id); await sleep(5000);
      if (s.link) { const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: a.id }, func: (re) => [...document.querySelectorAll("a[href]")].map((x) => x.href).find((h) => new RegExp(re).test(h)), args: [s.link] });
        report(s.name, "link", result || null); if (!result) throw new Error("нет ссылки"); if (s.name === "rutube") st.rtid = result.match(/[0-9a-f]{32}/)[0];
        await chrome.tabs.update(a.id, { url: result }); await waitComplete(a.id); await sleep(5000); }
      let frameId = 0;
      if (s.frame) { for (let i = 0; i < 20; i++) { const fr = (await chrome.webNavigation.getAllFrames({ tabId: a.id })) || []; const f = fr.find((x) => new RegExp(s.frame).test(x.url)); if (f) { frameId = f.frameId; report(s.name, "frame", f.url.slice(0, 120)); break; } await sleep(1000); } }
      const tabNow = await chrome.tabs.get(a.id); report(s.name, "tab", tabNow.url); const probe = await send(a.id, { cmd: "probe" }, frameId); report(s.name, "probe", probe);
      if (!probe.res) continue;
      b = await chrome.tabs.create({ url: BASE + "/connect.html", active: true, windowId: a.windowId }); await waitComplete(b.id); await sleep(5000);
      report(s.name, "background", await send(a.id, { cmd: "sample", label: "background(eaten+muted)", ms: 3000 }, frameId));
      const off = await send(a.id, { cmd: "pc-offer" }, frameId);
      if (!off.sdp) { report(s.name, "pc-offer", off); continue; }
      const ans = await send(b.id, { cmd: "recv", sdp: off.sdp }); await send(a.id, { cmd: "pc-answer", sdp: ans.sdp }, frameId);
      for (const t of [10, 25]) { await sleep(t === 10 ? 10000 : 15000); report(s.name, "loopback@" + t + "s", { recv: await send(b.id, { cmd: "recv-stats" }), send: await send(a.id, { cmd: "pc-stats" }, frameId) }); }
      report(s.name, "background-while-streaming", await send(a.id, { cmd: "sample", label: "bg+streaming", ms: 3000 }, frameId));
    } catch (e) { report(s.name, "error", String(e && e.message || e)); }
    finally { if (b) await chrome.tabs.remove(b.id).catch(() => {}); if (a) await chrome.tabs.remove(a.id).catch(() => {}); }
  }
  report("ALL", "DONE", {});
}
chrome.runtime.onInstalled.addListener(run); chrome.runtime.onStartup.addListener(run); run();
