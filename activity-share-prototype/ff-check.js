// Firefox: no-CORS захват и loopback RTCPeerConnection между вкладками (Playwright, main world).
process.env.NODE_PATH = "/home/aleksandr/mnt/work/da4-pw/node_modules"; require("module").Module._initPaths();
const pw = require("playwright"); require("./server.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await pw.firefox.launch({ headless: true, executablePath: process.env.HOME + "/.cache/ms-playwright/firefox-1553/firefox/firefox",
    firefoxUserPrefs: { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0, "media.peerconnection.ice.loopback": true, "media.peerconnection.ice.obfuscate_host_addresses": false, "media.navigator.permission.disabled": true } });
  const ctx = await b.newContext();
  const p = await ctx.newPage(); await p.goto("http://localhost:8099/nocors.html"); await sleep(6000);
  const r = await Promise.race([p.evaluate(async () => { const v = document.querySelector("video"); const o = { playing: !v.paused, t: v.currentTime };
    try { const s = (v.captureStream || v.mozCaptureStream).call(v); o.tracks = s.getTracks().map((t) => t.kind + ":" + (t.muted ? "muted" : "live") + ":" + t.readyState);
      const sink = document.createElement("video"); sink.muted = true; sink.srcObject = s; document.body.appendChild(sink); await sink.play().catch(() => {}); await new Promise((r) => setTimeout(r, 2500));
      const c = document.createElement("canvas"); c.width = 32; c.height = 18; const x = c.getContext("2d"); x.drawImage(sink, 0, 0, 32, 18);
      try { const d = x.getImageData(0, 0, 32, 18).data; let sm = 0; for (let i = 0; i < d.length; i += 4) sm += d[i]; o.luma = Math.round(sm / (d.length / 4)); } catch (e) { o.getImageData = e.name; }
      o.sinkSize = [sink.videoWidth, sink.videoHeight];
    } catch (e) { o.err = e.name + ": " + e.message; } return o; }), sleep(30000).then(() => "timeout")]);
  console.log("FF nocors:", JSON.stringify(r));
  // loopback: HLS-страница → вкладка B
  const a = await ctx.newPage(); await a.goto("https://hlsjs.video-dev.org/demo/?src=" + encodeURIComponent("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8")); await sleep(8000);
  const B = await ctx.newPage(); await B.goto("http://localhost:8099/connect.html");
  const off = await a.evaluate(async () => { const v = document.querySelector("video"); v.muted = true; v.style.opacity = "0"; const s = (v.captureStream || v.mozCaptureStream).call(v);
    const pc = new RTCPeerConnection(); window.__pc = pc; s.getTracks().forEach((t) => pc.addTrack(t, s)); await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => { pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && r(); setTimeout(r, 4000); }); return pc.localDescription.sdp; });
  console.log("offer candidates:", (off.match(/a=candidate[^\r\n]*/g) || []).slice(0, 3));
  const ans = await B.evaluate((sdp) => window.recv(sdp), off); await a.evaluate((sdp) => window.__pc.setRemoteDescription({ type: "answer", sdp }), ans);
  await sleep(20000);
  console.log("FF loopback recv:", JSON.stringify(await B.evaluate(() => window.stats())));
  console.log("FF loopback send:", JSON.stringify(await a.evaluate(async () => { const o = {}; (await window.__pc.getStats()).forEach((r) => { if (r.type === "outbound-rtp" && r.kind === "video") Object.assign(o, { fps: r.framesPerSecond, w: r.frameWidth, h: r.frameHeight, bytes: r.bytesSent, enc: r.framesEncoded }); }); o.ice = window.__pc.iceConnectionState; return o; })));
  await b.close(); process.exit(0);
})();
