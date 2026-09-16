// 采集麦克风音频并重采样为 16kHz Int16 PCM
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    const outLen = Math.floor(ch.length / this.ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = ch[Math.floor(i * this.ratio)];
      out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
