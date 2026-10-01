export type GainPoint = { hz: number; db: number; slope?: number };
export type GainSegment = { points: GainPoint[] };

const logHz = (hz: number) => Math.log2(Math.max(1, hz));
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

// Shape-preserving Hermite interpolation avoids new peaks between pen samples.
export function compileGainSegment(segment: GainSegment) {
  const points = segment.points, x = points.map(point => logHz(point.hz));
  const slopes = points.slice(1).map((point, i) => (point.db - points[i].db) / (x[i + 1] - x[i]));
  const tangents = points.map((_, i) => {
    if (points[i].slope !== undefined) return points[i].slope!;
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes[i - 1];
    const a = slopes[i - 1], b = slopes[i];
    if (a * b <= 0) return 0;
    const before = x[i] - x[i - 1], after = x[i + 1] - x[i];
    const w1 = 2 * after + before, w2 = after + 2 * before;
    return (w1 + w2) / (w1 / a + w2 / b);
  });
  const interval = (hz: number) => {
    const value = logHz(hz);
    let low = 0, high = x.length - 1;
    while (high - low > 1) { const mid = (low + high) >> 1; if (x[mid] <= value) low = mid; else high = mid; }
    const width = x[high] - x[low], t = (value - x[low]) / width;
    return { low, high, width, t: clamp(t, 0, 1) };
  };
  const evaluate = (hz: number) => {
    const { low, high, width, t } = interval(hz);
    const value = (2 * t ** 3 - 3 * t ** 2 + 1) * points[low].db + (t ** 3 - 2 * t ** 2 + t) * width * tangents[low]
      + (-2 * t ** 3 + 3 * t ** 2) * points[high].db + (t ** 3 - t ** 2) * width * tangents[high];
    return clamp(value, Math.min(points[low].db, points[high].db), Math.max(points[low].db, points[high].db));
  };
  return Object.assign(evaluate, { derivative: (hz: number) => {
    const { low, high, width, t } = interval(hz);
    return (6 * t ** 2 - 6 * t) / width * points[low].db + (3 * t ** 2 - 4 * t + 1) * tangents[low]
      + (-6 * t ** 2 + 6 * t) / width * points[high].db + (3 * t ** 2 - 2 * t) * tangents[high];
  } });
}

export function curveFrequency(segments: GainSegment[], base: (hz: number) => number) {
  const compiled = segments.map(segment => ({ start: segment.points[0].hz, end: segment.points.at(-1)!.hz, evaluate: compileGainSegment(segment) }));
  return (hz: number) => {
    const segment = compiled.find(item => hz >= item.start && hz <= item.end);
    return segment ? segment.evaluate(hz) : base(hz);
  };
}

export function drawGainStroke(previous: GainSegment[], stroke: GainPoint[], base: (hz: number) => number, smoothing = .2): GainSegment[] {
  if (stroke.length < 2) return previous;
  const start = Math.min(...stroke.map(point => point.hz)), end = Math.max(...stroke.map(point => point.hz));
  const left = logHz(start), right = logHz(end), span = right - left;
  if (span < .025) return previous;
  const count = Math.max(12, Math.ceil(span * 96));
  const old = curveFrequency(previous, base);
  const raw: GainPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const hz = i === 0 ? start : i === count ? end : 2 ** (left + span * i / count);
    raw.push({ hz, db: old(hz) });
  }
  // Rasterize each pen segment in order, so later crossings replace earlier ones.
  for (let j = 1; j < stroke.length; j++) {
    const a = logHz(stroke[j - 1].hz), b = logHz(stroke[j].hz);
    if (a === b) continue;
    const from = Math.max(0, Math.ceil((Math.min(a, b) - left) / span * count - 1e-9));
    const to = Math.min(count, Math.floor((Math.max(a, b) - left) / span * count + 1e-9));
    for (let i = from; i <= to; i++) {
      const x = left + span * i / count;
      raw[i].db = stroke[j - 1].db + (stroke[j].db - stroke[j - 1].db) * (x - a) / (b - a);
    }
  }
  const radius = Math.round(clamp(smoothing, 0, 1) * 6);
  const fade = Math.min(.06, span / 8);
  const smoothstep = (t: number) => { const v = clamp(t, 0, 1); return v * v * (3 - 2 * v); };
  const points = raw.map((point, i) => {
    let total = 0, weights = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(count, i + radius); j++) {
      const weight = radius + 1 - Math.abs(i - j); total += raw[j].db * weight; weights += weight;
    }
    const x = logHz(point.hz), blend = smoothstep((x - left) / fade) * smoothstep((right - x) / fade);
    return { hz: point.hz, db: old(point.hz) * (1 - blend) + total / weights * blend };
  });
  const result: GainSegment[] = [];
  for (const segment of previous) {
    const first = segment.points[0].hz, last = segment.points[segment.points.length - 1].hz;
    if (last <= start || first >= end) { result.push(segment); continue; }
    const evaluate = compileGainSegment(segment);
    const frozen = segment.points.map(point => ({ ...point, slope: evaluate.derivative(point.hz) }));
    if (first < start) result.push({ points: [...frozen.filter(point => point.hz < start), { hz: start, db: evaluate(start), slope: evaluate.derivative(start) }] });
    if (last > end) result.push({ points: [{ hz: end, db: evaluate(end), slope: evaluate.derivative(end) }, ...frozen.filter(point => point.hz > end)] });
  }
  result.push({ points });
  return result.sort((a, b) => a.points[0].hz - b.points[0].hz);
}

export function validGainSegments(segments: GainSegment[], limit: number) {
  if (!Array.isArray(segments) || segments.length > 128) return false;
  let end = 0, count = 0;
  for (const segment of segments) {
    if (!Array.isArray(segment.points) || segment.points.length < 2) return false;
    let hz = 0;
    for (const point of segment.points) {
      if (!Number.isFinite(point.hz) || point.hz <= hz || point.hz < 1 || point.hz > 192000 || !Number.isFinite(point.db) || Math.abs(point.db) > limit) return false;
      if (point.slope !== undefined && (!Number.isFinite(point.slope) || Math.abs(point.slope) > 1e6)) return false;
      hz = point.hz;
    }
    if (segment.points[0].hz < end) return false;
    end = hz; count += segment.points.length;
  }
  return count <= 16384;
}
