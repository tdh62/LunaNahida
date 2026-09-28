export type CustomFilter = {
  firSize: 2048 | 4096 | 8192 | 16384;
  frequencyBands: FrequencyBand[];
  time: string;
  durationMs: number;
  delays: { ms: number; gain: number }[];
};
export type FrequencyBand = { expression: string; startHz: number; endHz: number | null; transitionHz: number };
export type SavedEffect = { id: string; name: string; filter: CustomFilter };
export type FrequencyResponse = { sampleRate: number; values: Float32Array };

const fullBand = (expression: string): FrequencyBand => ({ expression, startHz: 0, endHz: null, transitionHz: 80 });
export const defaultCustomFilter: CustomFilter = { firSize: 8192, frequencyBands: [fullBand('0')], time: '0', durationMs: 400, delays: [] };
export const effectNames = ['原声', '低音增强', '空间回响', '温暖 Lo-fi'] as const;

export const effectDefinitions: Record<string, CustomFilter> = {
  原声: { firSize: 8192, frequencyBands: [fullBand('0')], time: '0', durationMs: 400, delays: [] },
  低音增强: { firSize: 8192, frequencyBands: [fullBand('10 / (1 + (f / 280)^4)')], time: '0', durationMs: 400, delays: [] },
  空间回响: { firSize: 8192, frequencyBands: [fullBand('0')], time: '0', durationMs: 400, delays: [{ ms: 190, gain: 0.45 }] },
  '温暖 Lo-fi': { firSize: 8192, frequencyBands: [fullBand('max(-24, -10 * log10(1 + (f / 1100)^4))')], time: '0', durationMs: 400, delays: [] },
};

export function selectedEffect(effect: string, saved: SavedEffect[]) {
  const custom = saved.find(item => item.id === effect);
  return { name: custom?.name ?? (effectDefinitions[effect] ? effect : '原声'), filter: custom?.filter ?? effectDefinitions[effect] ?? effectDefinitions['原声'] };
}

export function responseAt(response: FrequencyResponse, hz: number) {
  const position = Math.max(0, Math.min(response.values.length - 1, hz * (response.values.length - 1) * 2 / response.sampleRate));
  const left = Math.floor(position), right = Math.min(response.values.length - 1, left + 1);
  return response.values[left] + (response.values[right] - response.values[left]) * (position - left);
}

type Expression = (value: number) => number;
type Token = { kind: 'number' | 'name' | 'symbol'; value: string };
const functions: Record<string, (...args: number[]) => number> = {
  abs: Math.abs, cos: Math.cos, exp: Math.exp, log: Math.log, log10: Math.log10,
  log2: Math.log2, max: Math.max, min: Math.min, pow: Math.pow, sin: Math.sin,
  sqrt: Math.sqrt, tan: Math.tan,
};

export function compileExpression(source: string, variable: 'f' | 't'): Expression {
  if (!source.trim() || source.length > 200) throw new Error('表达式须为 1–200 个字符');
  const tokens: Token[] = [];
  const matcher = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:([eE][+-]?\d+))?|([a-zA-Z][a-zA-Z0-9]*)|([()+*/^,-]))/gy;
  let offset = 0;
  while (offset < source.length) {
    matcher.lastIndex = offset;
    const match = matcher.exec(source);
    if (!match) {
      if (source.slice(offset).trim() === '') break;
      throw new Error(`第 ${offset + 1} 个字符附近无法识别`);
    }
    offset = matcher.lastIndex;
    tokens.push({ kind: match[1] ? 'number' : match[3] ? 'name' : 'symbol', value: match[1] ? match[1] + (match[2] ?? '') : match[3] ?? match[4] });
    if (tokens.length > 100) throw new Error('表达式过于复杂');
  }
  let index = 0;
  const peek = () => tokens[index]?.value;
  const take = (value: string) => { if (peek() !== value) return false; index++; return true; };
  const expression = (): Expression => {
    let left = product();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[index++].value, right = product(), previous = left;
      left = value => op === '+' ? previous(value) + right(value) : previous(value) - right(value);
    }
    return left;
  };
  const product = (): Expression => {
    let left = unary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[index++].value, right = unary(), previous = left;
      left = value => op === '*' ? previous(value) * right(value) : previous(value) / right(value);
    }
    return left;
  };
  const unary = (): Expression => {
    if (take('+')) return unary();
    if (take('-')) { const operand = unary(); return value => -operand(value); }
    return power();
  };
  const power = (): Expression => {
    const left = primary();
    if (!take('^')) return left;
    const right = unary();
    return value => left(value) ** right(value);
  };
  const primary = (): Expression => {
    if (take('(')) {
      const inner = expression();
      if (!take(')')) throw new Error('缺少右括号');
      return inner;
    }
    const token = tokens[index++];
    if (!token) throw new Error('表达式不完整');
    if (token.kind === 'number') { const constant = Number(token.value); return () => constant; }
    if (token.kind !== 'name') throw new Error(`意外的符号 ${token.value}`);
    if (token.value === variable) return value => value;
    if (token.value === 'pi') return () => Math.PI;
    if (token.value === 'e') return () => Math.E;
    const fn = functions[token.value];
    if (!fn || !take('(')) throw new Error(`未知函数或变量 ${token.value}`);
    const args: Expression[] = [];
    if (!take(')')) {
      do { args.push(expression()); } while (take(','));
      if (!take(')')) throw new Error('函数缺少右括号');
    }
    const expected = token.value === 'min' || token.value === 'max' || token.value === 'pow' ? 2 : 1;
    if (args.length !== expected) throw new Error(`${token.value} 需要 ${expected} 个参数`);
    return value => fn(...args.map(arg => arg(value)));
  };
  const result = expression();
  if (index !== tokens.length) throw new Error(`意外的符号 ${peek()}`);
  return result;
}

export function validateFilter(filter: CustomFilter, sampleRate: number) {
  if (![2048, 4096, 8192, 16384].includes(filter.firSize)) throw new Error('FIR 点数无效');
  if (!Array.isArray(filter.frequencyBands) || filter.frequencyBands.length < 1 || filter.frequencyBands.length > 8) throw new Error('频率函数须为 1–8 条');
  const nyquist = sampleRate / 2;
  const bands = filter.frequencyBands.map((band, index) => {
    if (!Number.isFinite(band.startHz) || band.startHz < 0 || band.startHz > 192000 ||
      (band.endHz !== null && (!Number.isFinite(band.endHz) || band.endHz <= band.startHz || band.endHz > 192000)) ||
      !Number.isFinite(band.transitionHz) || band.transitionHz < 0 || band.transitionHz > 10000) {
      throw new Error(`第 ${index + 1} 条频率函数的范围无效`);
    }
    return { ...band, evaluate: compileExpression(band.expression, 'f') };
  });
  const smoothstep = (value: number) => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
  const frequency = (hz: number) => {
    let total = 0;
    for (const band of bands) {
      const end = Math.min(band.endHz ?? nyquist, nyquist);
      if (band.startHz >= end) continue;
      const half = Math.min(band.transitionHz / 2, (end - band.startHz) / 2);
      const low = band.startHz === 0 ? 1 : half ? smoothstep((hz - band.startHz + half) / (2 * half)) : Number(hz >= band.startHz);
      const high = end === nyquist ? 1 : half ? 1 - smoothstep((hz - end + half) / (2 * half)) : Number(hz <= end);
      const weight = low * high;
      if (!weight) continue;
      const gain = band.evaluate(hz);
      if (!Number.isFinite(gain) || Math.abs(gain) > 24) throw new Error(`${Math.round(hz)} Hz 处的单条增益须在 ±24 dB 内`);
      total += weight * gain;
    }
    return total;
  };
  const time = compileExpression(filter.time, 't');
  if (!Number.isFinite(filter.durationMs) || filter.durationMs < 50 || filter.durationMs > 1000) throw new Error('时间响应长度须在 50–1000 ms 之间');
  if ((filter.delays?.length ?? 0) > 8) throw new Error('最多支持 8 个延迟点');
  let delayGain = 0;
  for (const delay of filter.delays ?? []) {
    if (!Number.isFinite(delay.ms) || delay.ms < 1 || delay.ms > filter.durationMs || !Number.isFinite(delay.gain) || Math.abs(delay.gain) > 1) throw new Error('延迟点时间或增益无效');
    delayGain += Math.abs(delay.gain);
  }
  if (delayGain > 1.5) throw new Error('延迟点总增益过大');
  let neutralFrequency = true;
  for (let i = 0; i <= filter.firSize / 2; i++) {
    const f = i * sampleRate / filter.firSize;
    const gain = frequency(f);
    if (!Number.isFinite(gain) || Math.abs(gain) > 24) throw new Error(`${Math.round(f)} Hz 处的合成增益须在 ±24 dB 内`);
    if (gain !== 0) neutralFrequency = false;
  }
  for (let i = 0; i <= 128; i++) {
    const t = i * filter.durationMs / 128 / 1000;
    const response = time(t);
    if (!Number.isFinite(response) || Math.abs(response) > 20) throw new Error(`${Math.round(t * 1000)} ms 处的响应过大`);
  }
  return { frequency, time, neutralFrequency };
}

function inverseFFT(real: Float64Array, imaginary: Float64Array, normalize = true) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = 2 * Math.PI / length;
    for (let start = 0; start < size; start += length) {
      for (let i = 0; i < length / 2; i++) {
        const cosine = Math.cos(angle * i), sine = Math.sin(angle * i);
        const a = start + i, b = a + length / 2;
        const r = real[b] * cosine - imaginary[b] * sine;
        const im = real[b] * sine + imaginary[b] * cosine;
        real[b] = real[a] - r; imaginary[b] = imaginary[a] - im;
        real[a] += r; imaginary[a] += im;
      }
    }
  }
  if (normalize) for (let i = 0; i < size; i++) real[i] /= size;
}

export function calculateFIRResponse(frequency: AudioBuffer): FrequencyResponse {
  const size = frequency.length;
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  real.set(frequency.getChannelData(0));
  inverseFFT(real, imaginary, false);
  const values = new Float32Array(size / 2 + 1);
  for (let i = 0; i < values.length; i++) {
    const power = real[i] ** 2 + imaginary[i] ** 2;
    values[i] = Math.max(-48, Math.min(24, 10 * Math.log10(Math.max(1e-12, power))));
  }
  return { sampleRate: frequency.sampleRate, values };
}

export function makeFrequencyImpulse(context: AudioContext, expression: Expression, size = 8192) {
  const half = size / 2;
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  for (let i = 0; i <= half; i++) {
    const gain = expression(i * context.sampleRate / size);
    if (!Number.isFinite(gain) || Math.abs(gain) > 24) throw new Error('频率函数产生了超出 ±24 dB 的值');
    real[i] = real[size - i] = 10 ** (gain / 20);
  }
  inverseFFT(real, imaginary);
  const buffer = context.createBuffer(1, size, context.sampleRate);
  const output = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) {
    const shifted = real[(i - half + size) % size];
    const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (size - 1));
    output[i] = shifted * window;
  }
  return buffer;
}

export function makeTimeImpulse(context: AudioContext, expression: Expression, durationMs: number, delays: CustomFilter['delays'] = []) {
  const length = Math.ceil(context.sampleRate * durationMs / 1000) + 1;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const output = buffer.getChannelData(0);
  output[0] = 1;
  let wetSum = 0;
  for (let i = 1; i < length; i++) {
    const value = expression(i / context.sampleRate) / context.sampleRate;
    if (!Number.isFinite(value)) throw new Error('时间函数产生了无效值');
    output[i] = value;
    wetSum += Math.abs(value);
  }
  for (const delay of delays) {
    output[Math.round(context.sampleRate * delay.ms / 1000)] += delay.gain;
    wetSum += Math.abs(delay.gain);
  }
  if (wetSum > 1.5) throw new Error('时间响应总增益过大，请降低函数幅度');
  return buffer;
}
