const http = require("http"); const crypto = require("crypto");
const MP4 = "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4";
const HLSDEMO = "https://hlsjs.video-dev.org/demo/?src=" + encodeURIComponent("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8");
const pages = {
  "/connect.html": `<!doctype html><title>B</title><video id=v autoplay playsinline style="width:640px"></video><script>
let pc; window.recv = async (sdp) => { pc = new RTCPeerConnection(); pc.ontrack = (e) => { if (e.track.kind === "video") { const v = document.getElementById("v"); v.srcObject = e.streams[0]; v.play().catch(()=>{}); } };
 await pc.setRemoteDescription({ type: "offer", sdp }); await pc.setLocalDescription(await pc.createAnswer());
 await new Promise((r) => { if (pc.iceGatheringState === "complete") r(); pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && r(); setTimeout(r, 3000); });
 return pc.localDescription.sdp; };
window.stats = async () => { const s = await pc.getStats(); const o = {}; s.forEach((r) => {
  if (r.type === "inbound-rtp" && r.kind === "video") Object.assign(o, { fps: r.framesPerSecond, w: r.frameWidth, h: r.frameHeight, decoded: r.framesDecoded, kbps: null, jbMs: r.jitterBufferEmittedCount ? Math.round(r.jitterBufferDelay / r.jitterBufferEmittedCount * 1000) : null, codec: r.codecId, decoder: r.decoderImplementation });
  if (r.type === "inbound-rtp" && r.kind === "audio") Object.assign(o, { audioLevel: r.audioLevel, audioEnergy: r.totalAudioEnergy }); });
 const v = document.getElementById("v"); const c = document.createElement("canvas"); c.width = 32; c.height = 18; const x = c.getContext("2d"); x.drawImage(v, 0, 0, 32, 18);
 const d = x.getImageData(0, 0, 32, 18).data; let sm = 0; for (let i = 0; i < d.length; i += 4) sm += (d[i] + d[i+1] + d[i+2]) / 3; o.luma = Math.round(sm / (d.length / 4)); o.vis = document.visibilityState; return o; };
window.hello = (id) => new Promise((r) => { try { chrome.runtime.sendMessage(id, { type: "hello" }, (x) => r(x || ("lastError: " + (chrome.runtime.lastError && chrome.runtime.lastError.message)))); } catch (e) { r("throw: " + e.message); } });
</script>`,
  "/nocors.html": `<!doctype html><video src="${MP4}" autoplay loop playsinline controls style="width:800px"></video>`,
  "/cors.html": `<!doctype html><video src="${MP4}" crossorigin="anonymous" autoplay loop playsinline controls style="width:800px"></video>`,
  "/iframe-hls.html": `<!doctype html><h3>Сайт с плеером в чужом iframe (как у сайтов с аниме)</h3><iframe src="${HLSDEMO}" width=1000 height=700 allow="autoplay; fullscreen"></iframe>`,
  "/iframe-yt.html": `<!doctype html><iframe src="https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1&mute=1" width=960 height=540 allow="autoplay; fullscreen"></iframe>`,
  "/csp.html": `<!doctype html><title>csp</title><p>strict CSP page</p>`,
};
const handler = (q, s) => {
  const u = q.url.split("?")[0];
  if (u === "/plan.json") { s.writeHead(200, {"content-type":"application/json"}); return s.end(require("fs").existsSync(__dirname + "/plan.json") ? require("fs").readFileSync(__dirname + "/plan.json") : "{}"); }
  if (u === "/report" && q.method === "POST") { let b = ""; q.on("data", (c) => b += c); q.on("end", () => { require("fs").appendFileSync(__dirname + "/results-real.jsonl", b + "\n"); try { const o = JSON.parse(b); console.log(new Date().toISOString().slice(11,19), o.name, o.step, JSON.stringify(o.data).slice(0, 1500)); } catch (e) { console.log(b.slice(0, 500)); } s.writeHead(204, {"access-control-allow-origin":"*"}); s.end(); }); return; }
  if (u.startsWith("/iframe-rt.html")) { const id = new URL(q.url, "http://x").searchParams.get("id"); s.writeHead(200, {"content-type":"text/html; charset=utf-8"}); return s.end(`<!doctype html><iframe src="https://rutube.ru/play/embed/${id}?autoplay=1" width=960 height=540 allow="autoplay; fullscreen"></iframe>`); }
  if (!pages[u]) { s.writeHead(404); return s.end(); }
  const h = { "content-type": "text/html; charset=utf-8" };
  if (u === "/csp.html") h["content-security-policy"] = "default-src \x27self\x27; connect-src \x27self\x27";
  s.writeHead(200, h); s.end(pages[u]);
};
http.createServer(handler).listen(8099, "127.0.0.1"); http.createServer(handler).listen(8099, "::1");
const ws = http.createServer(); ws.on("upgrade", (q, sock) => { const k = q.headers["sec-websocket-key"]; const a = crypto.createHash("sha1").update(k + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + a + "\r\n\r\n"); setTimeout(() => sock.destroy(), 2000); });
ws.listen(8100, "127.0.0.1");
console.log("listening 8099/8100");
