// Проба захвата плеера: общая библиотека для content script (isolated world) и main world.
// Ничего из продукта Connect не использует. T133, прототип «расширение съедает плеер».
(function (G) {
  if (G.__actProbe) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = { v: null, stream: null, overlay: null, pc: null, sender: null };

  function allVideos(root, out = [], depth = 0) {
    for (const v of root.querySelectorAll('video')) out.push(v);
    if (depth > 6) return out;
    for (const el of root.querySelectorAll('*')) {
      let sr = el.shadowRoot;
      try { if (!sr && G.chrome && chrome.dom && chrome.dom.openOrClosedShadowRoot) sr = chrome.dom.openOrClosedShadowRoot(el); } catch (e) {}
      if (sr) { st.shadow = (st.shadow || 0) + 1; allVideos(sr, out, depth + 1); }
    }
    return out;
  }
  function pickVideo() {
    const vs = allVideos(document);
    if (!vs.length) return null;
    const score = (v) => (v.paused ? 0 : 1e9) + (v.videoWidth * v.videoHeight || v.clientWidth * v.clientHeight);
    return vs.sort((a, b) => score(b) - score(a))[0];
  }

  async function waitPlaying(v, ms = 20000) {
    const t0 = performance.now();
    let last = v.currentTime;
    while (performance.now() - t0 < ms) {
      if (v.paused) { try { await Promise.race([v.play(), sleep(1500)]); } catch (e) {} }
      await sleep(500);
      if (v.currentTime > last + 0.2) return true;
      last = v.currentTime;
    }
    return false;
  }

  async function luma(src, w, h) {
    try {
      const c = new OffscreenCanvas(32, 18);
      const x = c.getContext('2d');
      x.drawImage(src, 0, 0, 32, 18);
      const d = x.getImageData(0, 0, 32, 18).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return Math.round(s / (d.length / 4));
    } catch (e) { return 'err:' + e.name; }
  }

  async function measureVideo(track, ms) {
    if (!track) return null;
    if (typeof MediaStreamTrackProcessor === 'function') {
      const p = new MediaStreamTrackProcessor({ track: track.clone() });
      const r = p.readable.getReader();
      let n = 0, w = 0, h = 0, l = null;
      const t0 = performance.now();
      const timer = setTimeout(() => r.cancel().catch(() => {}), ms + 300);
      for (;;) {
        const res = await r.read().catch(() => ({ done: true }));
        if (res.done) break;
        const f = res.value; n++; w = f.displayWidth; h = f.displayHeight;
        if (l === null && n > 3) l = await luma(f);
        f.close();
        if (performance.now() - t0 > ms) { r.cancel().catch(() => {}); break; }
      }
      clearTimeout(timer);
      return { via: 'MSTP', fps: +(n / (ms / 1000)).toFixed(1), w, h, luma: l, trackMuted: track.muted, ready: track.readyState };
    }
    // запасной путь (Firefox/WebKit): приёмник-<video> + requestVideoFrameCallback
    const sink = document.createElement('video');
    sink.muted = true; sink.playsInline = true; sink.srcObject = new MediaStream([track]);
    sink.style.cssText = 'position:fixed;left:0;bottom:0;width:64px;height:36px;z-index:2147483647;';
    document.documentElement.appendChild(sink);
    try { await sink.play(); } catch (e) {}
    let n = 0;
    const has = 'requestVideoFrameCallback' in sink;
    if (has) { const cb = () => { n++; sink.requestVideoFrameCallback(cb); }; sink.requestVideoFrameCallback(cb); }
    await sleep(ms);
    let l = null;
    try { const c = document.createElement('canvas'); c.width = 32; c.height = 18; const x = c.getContext('2d'); x.drawImage(sink, 0, 0, 32, 18); const d = x.getImageData(0, 0, 32, 18).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; l = Math.round(s / (d.length / 4)); } catch (e) { l = 'err:' + e.name; }
    const out = { via: has ? 'rVFC' : 'sink', fps: has ? +(n / (ms / 1000)).toFixed(1) : null, w: sink.videoWidth, h: sink.videoHeight, luma: l, trackMuted: track.muted, ready: track.readyState };
    sink.remove();
    return out;
  }

  async function measureAudio(track, ms) {
    if (!track) return null;
    const ctx = new (G.AudioContext || G.webkitAudioContext)();
    try { await ctx.resume(); } catch (e) {}
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(an); an.connect(g); g.connect(ctx.destination);
    const buf = new Float32Array(an.fftSize);
    let peak = 0; const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await sleep(100);
      an.getFloatTimeDomainData(buf);
      let s = 0; for (const x of buf) s += x * x;
      peak = Math.max(peak, Math.sqrt(s / buf.length));
    }
    const state = ctx.state; ctx.close();
    return { rmsDb: peak > 0 ? +(20 * Math.log10(peak)).toFixed(1) : -Infinity, ctx: state, trackMuted: track.muted };
  }

  function applyHide(v, mode) {
    v.style.opacity = ''; v.style.visibility = ''; v.style.transform = ''; v.style.display = '';
    if (st.overlay) { st.overlay.remove(); st.overlay = null; }
    if (mode === 'opacity0') v.style.opacity = '0';
    if (mode === 'visibility') v.style.visibility = 'hidden';
    if (mode === 'offscreen') v.style.transform = 'translate(-20000px,0)';
    if (mode === 'display-none') v.style.display = 'none';
    if (mode === 'overlay' || mode === 'eaten') {
      const r = v.getBoundingClientRect();
      const o = document.createElement('div');
      o.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:#000;z-index:2147483647;pointer-events:auto;`;
      document.documentElement.appendChild(o); st.overlay = o;
      if (mode === 'eaten') v.style.opacity = '0';
    }
  }

  async function sample(label, ms = 2000) {
    const v = st.v; const t = v.currentTime;
    const vt = st.stream && st.stream.getVideoTracks()[0];
    const at = st.stream && st.stream.getAudioTracks()[0];
    const [mv, ma] = await Promise.all([measureVideo(vt, ms), measureAudio(at, ms)]);
    return { label, vis: document.visibilityState, playing: !v.paused, advanced: +(v.currentTime - t).toFixed(2), muted: v.muted, volume: v.volume, video: mv, audio: ma };
  }

  async function cmd(c) {
    if (c.cmd === 'probe') {
      let v = pickVideo();
      for (let i = 0; i < 20 && (!v || v.paused); i++) {
        if (i === 5 || i === 12) { const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); if (el) el.click(); }
        await sleep(1000); v = pickVideo();
      }
      const diag = () => ({ title: document.title, text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 400), videos: document.querySelectorAll('video').length, deepVideos: allVideos(document).length, shadowRoots: st.shadow || 0 });
      if (!v) return { error: 'no <video>', diag: diag(), frames: document.querySelectorAll('iframe').length, iframes: [...document.querySelectorAll('iframe')].map((f) => (f.src || '').slice(0, 120)) };
      st.v = v;
      const playing = await waitPlaying(v);
      const info = { inShadow: !document.contains(v), diag: ((!v.currentSrc || v.paused) ? diag() : null), adShowing: !!document.querySelector('.ad-showing'), href: location.href.slice(0, 120), playing, src: (v.currentSrc || '').slice(0, 100), srcKind: (v.currentSrc || '').startsWith('blob:') ? 'MSE/blob' : 'url', crossOriginAttr: v.crossOrigin, mediaKeys: !!v.mediaKeys, size: [v.videoWidth, v.videoHeight], hasCapture: typeof v.captureStream === 'function', hasMoz: typeof v.mozCaptureStream === 'function' };
      try {
        st.stream = (v.captureStream ? v.captureStream() : v.mozCaptureStream());
        info.tracks = st.stream.getTracks().map((t) => `${t.kind}:${t.muted ? 'muted' : 'live'}:${t.readyState}`);
      } catch (e) { info.captureError = e.name + ': ' + e.message; return { info }; }
      await sleep(1500);
      info.tracksAfter = st.stream.getTracks().map((t) => `${t.kind}:${t.muted ? 'muted' : 'live'}:${t.readyState}`);
      v.muted = false; v.volume = 1;
      const res = [await sample('visible')];
      for (const m of c.modes || ['opacity0', 'overlay', 'visibility', 'offscreen', 'display-none']) { applyHide(v, m); await sleep(500); res.push(await sample('hide:' + m)); }
      applyHide(v, 'eaten'); v.muted = true; await sleep(500); res.push(await sample('eaten+muted'));
      v.muted = false; v.volume = 0; await sleep(500); res.push(await sample('eaten+volume0'));
      v.volume = 1; v.muted = true; // итоговое состояние «съеденного» плеера
      return { info, res };
    }
    if (c.cmd === 'sample') return sample(c.label || 'sample', c.ms || 3000);
    if (c.cmd === 'pc-offer') {
      const pc = new RTCPeerConnection({ iceServers: [] }); st.pc = pc;
      for (const t of st.stream.getTracks()) {
        const s = pc.addTrack(t, st.stream);
        if (t.kind === 'video') { t.contentHint = 'motion'; st.sender = s; }
      }
      const off = await pc.createOffer(); await pc.setLocalDescription(off);
      await new Promise((r) => { if (pc.iceGatheringState === 'complete') r(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r(); setTimeout(r, 3000); });
      return { sdp: pc.localDescription.sdp };
    }
    if (c.cmd === 'pc-answer') {
      await st.pc.setRemoteDescription({ type: 'answer', sdp: c.sdp });
      try { const p = st.sender.getParameters(); p.degradationPreference = 'maintain-framerate'; if (p.encodings && p.encodings[0]) { p.encodings[0].maxBitrate = 8_000_000; p.encodings[0].maxFramerate = 60; } await st.sender.setParameters(p); } catch (e) {}
      return { ok: true };
    }
    if (c.cmd === 'pc-stats') {
      const s = await st.pc.getStats(); const out = {};
      s.forEach((r) => { if (r.type === 'outbound-rtp' && r.kind === 'video') Object.assign(out, { fps: r.framesPerSecond, w: r.frameWidth, h: r.frameHeight, limit: r.qualityLimitationReason, encoder: r.encoderImplementation, codec: r.codecId, bytes: r.bytesSent, target: r.targetBitrate }); });
      return out;
    }
    if (c.cmd === 'ws-test') {
      return await new Promise((r) => { let ws; try { ws = new WebSocket(c.url); } catch (e) { return r('throw:' + e.name); } ws.onopen = () => { ws.close(); r('open'); }; ws.onerror = () => r('error'); setTimeout(() => r('timeout'), 4000); });
    }
    if (c.cmd === 'fetch-test') {
      try { const x = await fetch(c.url); return 'status:' + x.status; } catch (e) { return 'throw:' + e.name; }
    }
    if (c.cmd === 'recv') {
      const pc = new RTCPeerConnection({ iceServers: [] }); st.rpc = pc;
      const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.style.cssText = 'width:640px;display:block'; document.body.appendChild(v); st.rv = v;
      pc.ontrack = (e) => { if (!v.srcObject) { v.srcObject = e.streams[0]; v.play().catch(() => {}); } };
      await pc.setRemoteDescription({ type: 'offer', sdp: c.sdp }); await pc.setLocalDescription(await pc.createAnswer());
      await new Promise((r) => { if (pc.iceGatheringState === 'complete') r(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r(); setTimeout(r, 3000); });
      return { sdp: pc.localDescription.sdp };
    }
    if (c.cmd === 'recv-stats') {
      const s = await st.rpc.getStats(); const o = { vis: document.visibilityState }; const codecs = {};
      s.forEach((r) => { if (r.type === 'codec') codecs[r.id] = r.mimeType; });
      s.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') Object.assign(o, { fps: r.framesPerSecond, w: r.frameWidth, h: r.frameHeight, decoded: r.framesDecoded, dropped: r.framesDropped, jbMs: r.jitterBufferEmittedCount ? Math.round(r.jitterBufferDelay / r.jitterBufferEmittedCount * 1000) : null, codec: codecs[r.codecId], decoder: r.decoderImplementation, mbit: null, bytes: r.bytesReceived });
        if (r.type === 'inbound-rtp' && r.kind === 'audio') Object.assign(o, { audioLevel: r.audioLevel, audioEnergy: r.totalAudioEnergy, audioJbMs: r.jitterBufferEmittedCount ? Math.round(r.jitterBufferDelay / r.jitterBufferEmittedCount * 1000) : null });
      });
      o.luma = await luma(st.rv).catch(() => null);
      return o;
    }
    return { error: 'unknown cmd' };
  }

  G.__actProbe = cmd;
  try { if (G.chrome && chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener((m, sender, send) => { if (!m || !m.__actc) return; cmd(m.__actc).then(send, (e) => send({ error: String(e && e.stack || e) })); return true; }); } catch (e) {}
  // согласие YouTube/Google в ЕС (выход прокси) — только для прототипа
  if (location.hostname === 'consent.youtube.com' || location.hostname === 'consent.google.com') {
    const tryClick = () => { const b = [...document.querySelectorAll('button')].find((x) => /Accept all|Reject all|Принять все|Отклонить все|Alle akzeptieren|Alles accepteren/i.test(x.textContent)); if (b) b.click(); else setTimeout(tryClick, 500); };
    G.addEventListener('DOMContentLoaded', tryClick);
  }
  // Канал для harness: window.postMessage({__act:'req', id, c}) → ответ {__act:'res', id, r}
  G.addEventListener('message', async (e) => {
    const d = e.data;
    if (!d || d.__act !== 'req' || e.source !== window) return;
    let r; try { r = await cmd(d.c); } catch (err) { r = { error: String(err && err.stack || err) }; }
    window.postMessage({ __act: 'res', id: d.id, r }, '*');
  });
})(typeof window !== 'undefined' ? window : self);
