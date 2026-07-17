'use strict';

let activeJob = null;

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normal01(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function gammaSample(shape, random) {
  if (shape < 1) {
    const u = Math.max(random(), Number.MIN_VALUE);
    return gammaSample(shape + 1, random) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x;
    let v;
    do {
      x = normal01(random);
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(a, b, random) {
  const x = gammaSample(a, random);
  const y = gammaSample(b, random);
  return x / (x + y);
}

function sampleQuantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function postProgress(jobId, completed, total, partial = {}) {
  postMessage({ type: 'progress', jobId, completed, total, partial });
}

function cancelled(jobId) { return activeJob !== jobId; }

function simulateP1(jobId, params) {
  const random = mulberry32(params.seed);
  let covered = 0;
  let sumLength = 0;
  let sumEmv = 0;
  let sumMse = 0;
  const intervals = [];
  const batch = 500;
  for (let replicate = 0; replicate < params.B; replicate++) {
    if (cancelled(jobId)) return;
    let sum = 0;
    for (let index = 0; index < params.n; index++) {
      const u = Math.max(random(), Number.MIN_VALUE);
      sum += -Math.log(u) / params.theta;
    }
    const lo = params.qLow / sum;
    const hi = params.qHigh / sum;
    const emv = params.n / sum;
    const hit = lo <= params.theta && params.theta <= hi;
    covered += hit ? 1 : 0;
    sumLength += hi - lo;
    sumEmv += emv;
    sumMse += (emv - params.theta) ** 2;
    if (intervals.length < 100) intervals.push({ lo, hi, hit });
    if ((replicate + 1) % batch === 0 || replicate + 1 === params.B) {
      const completed = replicate + 1;
      postProgress(jobId, completed, params.B, {
        coverage: covered / completed,
        length: sumLength / completed,
        bias: sumEmv / completed - params.theta,
        mse: sumMse / completed
      });
    }
  }
  postMessage({ type: 'result', jobId, problem: 1, result: {
    coverage: covered / params.B,
    length: sumLength / params.B,
    bias: sumEmv / params.B - params.theta,
    mse: sumMse / params.B,
    intervals,
    theta: params.theta
  } });
}

function simulateP2(jobId, params) {
  const random = mulberry32(params.seed);
  let covered = 0;
  const batch = 500;
  for (let replicate = 0; replicate < params.B; replicate++) {
    if (cancelled(jobId)) return;
    let successes = 0;
    for (let index = 0; index < params.n; index++) successes += random() < params.prob ? 1 : 0;
    const estimate = successes / params.n;
    covered += Math.abs(estimate - params.prob) <= params.error + 1e-12 ? 1 : 0;
    if ((replicate + 1) % batch === 0 || replicate + 1 === params.B) {
      postProgress(jobId, replicate + 1, params.B, { coverage: covered / (replicate + 1) });
    }
  }
  postMessage({ type: 'result', jobId, problem: 2, result: { coverage: covered / params.B } });
}

function simulateP3(jobId, params) {
  const random = mulberry32(params.seed);
  let mean;
  let variance;
  if (params.dist === 'twopoint') {
    mean = params.param * params.a + (1 - params.param) * params.b;
    variance = params.param * (1 - params.param) * (params.b - params.a) ** 2;
  } else if (params.dist === 'uniform') {
    mean = (params.a + params.b) / 2;
    variance = (params.b - params.a) ** 2 / 12;
  } else {
    mean = (params.a + params.b) / 2;
    variance = (params.b - params.a) ** 2 / (4 * (2 * params.shape + 1));
  }
  let coveredConservative = 0;
  let coveredHoeffding = 0;
  const halfConservative = params.z * (params.b - params.a) / (2 * Math.sqrt(params.n));
  const halfHoeffding = (params.b - params.a) * Math.sqrt(Math.log(2 / params.alpha) / (2 * params.n));
  const batch = 500;
  for (let replicate = 0; replicate < params.B; replicate++) {
    if (cancelled(jobId)) return;
    let sum = 0;
    for (let index = 0; index < params.n; index++) {
      let value;
      if (params.dist === 'twopoint') value = random() < params.param ? params.a : params.b;
      else if (params.dist === 'uniform') value = params.a + (params.b - params.a) * random();
      else value = params.a + (params.b - params.a) * betaSample(params.shape, params.shape, random);
      sum += value;
    }
    const sampleMean = sum / params.n;
    coveredConservative += sampleMean - halfConservative <= mean && mean <= sampleMean + halfConservative ? 1 : 0;
    coveredHoeffding += sampleMean - halfHoeffding <= mean && mean <= sampleMean + halfHoeffding ? 1 : 0;
    if ((replicate + 1) % batch === 0 || replicate + 1 === params.B) {
      postProgress(jobId, replicate + 1, params.B, {
        covCon: coveredConservative / (replicate + 1),
        covHoeff: coveredHoeffding / (replicate + 1)
      });
    }
  }
  postMessage({ type: 'result', jobId, problem: 3, result: {
    mean,
    variance,
    bound: (params.b - params.a) ** 2 / 4,
    covCon: coveredConservative / params.B,
    covHoeff: coveredHoeffding / params.B,
    lenCon: 2 * halfConservative,
    lenHoeff: 2 * halfHoeffding
  } });
}

function calculateEstimators(theta, n, random) {
  let sumX = 0;
  let sumLog = 0;
  for (let index = 0; index < n; index++) {
    const u = Math.max(random(), Number.MIN_VALUE);
    const x = Math.pow(u, 1 / (theta + 1));
    sumX += x;
    sumLog += Math.log(x);
  }
  const sampleMean = sumX / n;
  const moments = (2 * sampleMean - 1) / Math.max(1 - sampleMean, 1e-14);
  const emv = -n / sumLog - 1;
  const corrected = -(n - 1) / sumLog - 1;
  return [moments, emv, corrected];
}

function simulateP4(jobId, params) {
  const random = mulberry32(params.seed);
  const names = ['Momentos', 'EMV', 'EMV corregido'];
  const sums = [0, 0, 0];
  const sumsSquared = [0, 0, 0];
  const mse = [0, 0, 0];
  const samples = [[], [], []];
  const sizes = params.sizes || [5, 10, 20, 40, 80, 150];
  const total = params.B * (1 + sizes.length);
  const batch = 500;

  for (let replicate = 0; replicate < params.B; replicate++) {
    if (cancelled(jobId)) return;
    const values = calculateEstimators(params.theta, params.n, random);
    for (let index = 0; index < 3; index++) {
      sums[index] += values[index];
      sumsSquared[index] += values[index] ** 2;
      mse[index] += (values[index] - params.theta) ** 2;
      if (samples[index].length < 2500 && Number.isFinite(values[index])) samples[index].push(values[index]);
    }
    if ((replicate + 1) % batch === 0 || replicate + 1 === params.B) {
      postProgress(jobId, replicate + 1, total, { phase: 'distribution' });
    }
  }

  const stats = names.map((name, index) => {
    const mean = sums[index] / params.B;
    const variance = params.B > 1
      ? Math.max(0, (sumsSquared[index] - params.B * mean ** 2) / (params.B - 1))
      : 0;
    return { name, bias: mean - params.theta, variance, mse: mse[index] / params.B };
  });

  const mseCurve = [];
  let completedBase = params.B;
  for (const size of sizes) {
    const curveMse = [0, 0, 0];
    for (let replicate = 0; replicate < params.B; replicate++) {
      if (cancelled(jobId)) return;
      const values = calculateEstimators(params.theta, size, random);
      for (let index = 0; index < 3; index++) curveMse[index] += (values[index] - params.theta) ** 2;
      if ((replicate + 1) % batch === 0 || replicate + 1 === params.B) {
        postProgress(jobId, completedBase + replicate + 1, total, { phase: 'mse', size });
      }
    }
    mseCurve.push({ n: size, mse: curveMse.map(value => value / params.B) });
    completedBase += params.B;
  }

  postMessage({ type: 'result', jobId, problem: 4, result: { stats, samples, mseCurve, theta: params.theta } });
}

function simulateP5(jobId, params) {
  const random = mulberry32(params.seed);
  const innerCount = params.mode === 'nested' ? params.inner : 0;
  const total = params.B + innerCount;
  let ratioLow;
  let ratioHigh;
  if (params.mode === 'nested') {
    const ratios = [];
    const innerBatch = 200;
    for (let index = 0; index < params.inner; index++) {
      if (cancelled(jobId)) return;
      ratios.push(Math.pow(Math.max(random(), Number.MIN_VALUE), -1 / params.n));
      if ((index + 1) % innerBatch === 0 || index + 1 === params.inner) {
        postProgress(jobId, index + 1, total, { phase: 'inner' });
      }
    }
    ratios.sort((a, b) => a - b);
    ratioLow = sampleQuantile(ratios, params.alpha / 2);
    ratioHigh = sampleQuantile(ratios, 1 - params.alpha / 2);
  } else {
    ratioLow = Math.pow(1 - params.alpha / 2, -1 / params.n);
    ratioHigh = Math.pow(params.alpha / 2, -1 / params.n);
  }

  let exact = 0;
  let percentile = 0;
  let basic = 0;
  let pivotal = 0;
  const batch = 500;
  for (let replicate = 0; replicate < params.B; replicate++) {
    if (cancelled(jobId)) return;
    const maximumUniform = Math.pow(Math.max(random(), Number.MIN_VALUE), 1 / params.n);
    const minimum = params.theta / maximumUniform;
    const exactLow = minimum * Math.pow(params.alpha / 2, 1 / params.n);
    const exactHigh = minimum * Math.pow(1 - params.alpha / 2, 1 / params.n);
    const percentileLow = minimum * ratioLow;
    const percentileHigh = minimum * ratioHigh;
    const basicLow = 2 * minimum - percentileHigh;
    const basicHigh = 2 * minimum - percentileLow;
    const pivotalLow = minimum / ratioHigh;
    const pivotalHigh = minimum / ratioLow;
    exact += exactLow <= params.theta && params.theta <= exactHigh ? 1 : 0;
    percentile += percentileLow <= params.theta && params.theta <= percentileHigh ? 1 : 0;
    basic += basicLow <= params.theta && params.theta <= basicHigh ? 1 : 0;
    pivotal += pivotalLow <= params.theta && params.theta <= pivotalHigh ? 1 : 0;
    if ((replicate + 1) % batch === 0 || replicate + 1 === params.B) {
      const completed = innerCount + replicate + 1;
      const denominator = replicate + 1;
      postProgress(jobId, completed, total, {
        phase: 'outer',
        exact: exact / denominator,
        percentile: percentile / denominator,
        basic: basic / denominator,
        pivotal: pivotal / denominator
      });
    }
  }
  postMessage({ type: 'result', jobId, problem: 5, result: {
    exact: exact / params.B,
    percentile: percentile / params.B,
    basic: basic / params.B,
    pivotal: pivotal / params.B,
    mode: params.mode
  } });
}

onmessage = event => {
  const { jobId, problem, params } = event.data;
  activeJob = jobId;
  try {
    if (problem === 1) simulateP1(jobId, params);
    else if (problem === 2) simulateP2(jobId, params);
    else if (problem === 3) simulateP3(jobId, params);
    else if (problem === 4) simulateP4(jobId, params);
    else if (problem === 5) simulateP5(jobId, params);
    else throw new Error('Problema de simulación no reconocido.');
  } catch (error) {
    postMessage({ type: 'error', jobId, message: error instanceof Error ? error.message : String(error) });
  }
};
