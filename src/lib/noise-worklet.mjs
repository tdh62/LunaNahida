export function createNoiseSampler(type, rate = 48000, random = Math.random) {
  if (!['white', 'pink', 'brown'].includes(type)) throw new Error('未知噪音类型');
  if (!Number.isFinite(rate) || rate < 8000) throw new Error('无效采样率');
  const white = () => random() * 2 - 1;
  if (type === 'white') return () => white() * .26;
  if (type === 'brown') {
    const decay = Math.exp(-2 * Math.PI * 5 / rate);
    const scale = Math.sqrt(1 - decay * decay) * .26;
    let previous = 0;
    return () => {
      previous = previous * decay + white() * scale;
      return Math.max(-.9, Math.min(.9, previous));
    };
  }
  const rows = Float64Array.from({ length: 16 }, white);
  let sum = rows.reduce((total, value) => total + value, 0);
  let counter = 0;
  const scale = .26 / Math.sqrt(rows.length + 1);
  return () => {
    counter = (counter + 1) & 65535;
    if (counter) {
      const index = 31 - Math.clz32(counter & -counter);
      sum -= rows[index];
      rows[index] = white();
      sum += rows[index];
    }
    return Math.max(-.9, Math.min(.9, (sum + white()) * scale));
  };
}

if (typeof registerProcessor === 'function') {
  class NoiseProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.sample = createNoiseSampler(options.processorOptions.type, sampleRate);
    }
    process(_inputs, outputs) {
      const channels = outputs[0];
      if (!channels?.length) return true;
      for (let index = 0; index < channels[0].length; index++) {
        const value = this.sample();
        for (const channel of channels) channel[index] = value;
      }
      return true;
    }
  }
  registerProcessor('lunanahida-noise', NoiseProcessor);
}
