// Отмечает начало щелчка 1 кГц (резкий рост RMS после тишины) во времени AudioContext.
class Onset extends AudioWorkletProcessor {
  constructor() { super(); this.quiet = 0; }
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (!ch) return true; let s = 0; for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i]; const rms = Math.sqrt(s / ch.length);
    if (rms > 0.05 && this.quiet > 0.3) { let k = 0; while (k < ch.length && Math.abs(ch[k]) < 0.05) k++; this.port.postMessage(currentTime + k / sampleRate); this.quiet = 0; }
    if (rms < 0.01) this.quiet += ch.length / sampleRate; else if (rms <= 0.05) this.quiet = 0; return true; } }
registerProcessor("onset", Onset);
