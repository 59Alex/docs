// Тестовый сервер прототипа «Connect Активность» (Electron): страницы-источники, токены LiveKit, приём отчётов.
const http = require("http"); const fs = require("fs"); const path = require("path");
const { AccessToken, TrackSource } = require("livekit-server-sdk");
const PORT = +process.env.PORT || 8790; const NM = path.join(__dirname, "node_modules");
const MP4 = "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4";
const HLS = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
const OUT = process.env.OUT || path.join(__dirname, "results-electron.jsonl");
// Источник для замеров: холст 1920×1080 с меткой времени (штрихкод 44 бита + инверсная строка), движение, щелчок звука на границе секунды.
const CLOCK = `<!doctype html><meta charset=utf-8><title>clock</title><style>html,body{margin:0;background:#222;color:#ccc;font:16px sans-serif}
#wrap{padding:20px}canvas{width:960px;height:540px;display:block;background:#000}</style><div id=wrap><h3>Тестовый «сайт» с плеером</h3>
<canvas id=player data-player width=1920 height=1080></canvas><p>Подпись под плеером, комментарии, реклама сайта…</p></div><script>
const c=document.getElementById("player"),x=c.getContext("2d");let n=0;
function bits(ms){const b=[];for(let i=43;i>=0;i--)b.push(Math.floor(ms/2**i)%2);return b}
function draw(){const ms=Date.now();n++;const t=performance.now()/1000;
 const g=x.createLinearGradient(0,0,1920,1080);g.addColorStop(0,"hsl("+(t*40%360)+",70%,40%)");g.addColorStop(1,"hsl("+((t*40+180)%360)+",70%,30%)");
 x.fillStyle=g;x.fillRect(0,0,1920,1080);
 for(let i=0;i<12;i++){x.fillStyle="hsl("+(i*30)+",80%,60%)";x.beginPath();x.arc(960+700*Math.sin(t*1.3+i),560+380*Math.cos(t*0.9+i*0.7),60,0,7);x.fill()}
 x.fillStyle="#fff";x.font="bold 120px monospace";x.fillText(String(n).padStart(6,"0"),660,620);
 const b=bits(ms);for(let i=0;i<44;i++){x.fillStyle=b[i]?"#fff":"#000";x.fillRect(i*40+20,0,40,40);x.fillStyle=b[i]?"#000":"#fff";x.fillRect(i*40+20,40,40,40)}
 x.fillStyle=(ms%1000)<60?"#fff":"#000";x.fillRect(1800,980,120,100);
 const FPS=+new URLSearchParams(location.search).get("fps")||0; if(FPS) setTimeout(draw,1000/FPS); else requestAnimationFrame(draw)}requestAnimationFrame(draw);
let ac;function beepLoop(){if(!ac){ac=new AudioContext();}
 setInterval(()=>{const ts=ac.getOutputTimestamp();if(!ts.performanceTime)return;const nowE=performance.timeOrigin+ts.performanceTime;
  const next=Math.ceil((nowE+150)/1000)*1000;if(next-nowE>450)return;if(beepLoop.last===next)return;beepLoop.last=next;
  const at=ts.contextTime+(next-nowE)/1000;const o=ac.createOscillator(),gn=ac.createGain();o.frequency.value=1000;gn.gain.value=0.5;o.connect(gn).connect(ac.destination);o.start(at);o.stop(at+0.06)},100);
 window.__srcAudio=()=>({baseLatency:ac.baseLatency,outputLatency:ac.outputLatency,state:ac.state})}
beepLoop();
</script>`;
const page = (body) => `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#111;color:#ddd;font:15px sans-serif}</style>${body}`;
const pages = {
  "/clock.html": CLOCK,
  "/hls.html": page(`<h3 style="margin:8px">HLS-плеер (hls.js, MSE)</h3><video id=v autoplay playsinline controls style="width:960px"></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script><script>const v=document.getElementById("v");if(Hls.isSupported()){const h=new Hls({startLevel:-1,capLevelToPlayerSize:false});h.loadSource("${HLS}");h.attachMedia(v);h.on(Hls.Events.MANIFEST_PARSED,()=>{h.currentLevel=h.levels.length-1;v.play().catch(()=>{})});window.hls=h}</script>`),
  "/nocors.html": page(`<h3 style="margin:8px">mp4 с чужого домена без CORS</h3><video src="${MP4}" autoplay loop playsinline controls style="width:960px"></video>`),
  "/yt.html": page(`<h3 style="margin:8px">YouTube embed</h3><iframe src="https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1" width=960 height=540 allow="autoplay; fullscreen"></iframe>`),
};
const pac = `function FindProxyForURL(url, host) { var d = ["localhost","127.0.0.1",".ru","jsdelivr.net",".mux.dev","test-videos.co.uk"];
 for (var i = 0; i < d.length; i++) { if (host === d[i] || dnsDomainIs(host, d[i])) return "DIRECT"; }
 return "SOCKS5 127.0.0.1:10808"; }`;
http.createServer(async (q, s) => {
  const u = new URL(q.url, "http://x"); const p = u.pathname;
  if (p === "/pac.js") { s.writeHead(200, { "content-type": "application/x-ns-proxy-autoconfig" }); return s.end(pac); }
  if (p === "/report" && q.method === "POST") { let b = ""; q.on("data", (c) => b += c); q.on("end", () => { fs.appendFileSync(OUT, b + "\n"); s.writeHead(204); s.end(); }); return; }
  if (p === "/token") { const at = new AccessToken("devkey", "secret", { identity: u.searchParams.get("identity"), ttl: "1h" });
    const pub = u.searchParams.get("publish") === "1";
    at.addGrant({ room: u.searchParams.get("room"), roomJoin: true, canPublish: pub, canSubscribe: !pub, canPublishSources: pub ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [] });
    s.writeHead(200, { "content-type": "text/plain" }); return s.end(await at.toJwt()); }
  if (p.startsWith("/lk/")) { const f = path.join(NM, "livekit-client/dist", path.basename(p)); if (fs.existsSync(f)) { s.writeHead(200, { "content-type": "text/javascript" }); return s.end(fs.readFileSync(f)); } }
  if (p === "/iframe-hls.html") { s.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return s.end(page(`<h3 style="margin:8px">Сайт с плеером в iframe чужого домена</h3><iframe src="http://localhost:${PORT}/hls.html" width=1000 height=640 allow="autoplay; fullscreen"></iframe>`)); }
  for (const f of ["app.html", "viewer.html", "viewer-audio-worklet.js"]) if (p === "/" + f) { s.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8" }); return s.end(fs.readFileSync(path.join(__dirname, f))); }
  if (pages[p]) { s.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return s.end(pages[p]); }
  s.writeHead(404); s.end();
}).listen(PORT, "127.0.0.1", () => console.log("server", PORT));
