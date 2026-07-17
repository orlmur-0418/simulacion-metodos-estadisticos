'use strict';

let activeJob = null;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal01(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function gammaSample(shape, rng) {
  if (shape < 1) {
    const u = Math.max(rng(), Number.MIN_VALUE);
    return gammaSample(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      x = normal01(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(a, b, rng) {
  const x = gammaSample(a, rng);
  const y = gammaSample(b, rng);
  return x / (x + y);
}

function postProgress(jobId, completed, total, partial = {}) {
  postMessage({ type: 'progress', jobId, completed, total, partial });
}

function cancelled(jobId) {
  return activeJob !== jobId;
}

function simulateP1(jobId, p) {
  const rng = mulberry32(p.seed);
  let covered = 0, sumLen = 0, sumMle = 0, sumMse = 0;
  const intervals = [];
  const batch = 500;
  for (let b = 0; b < p.B; b++) {
    if (cancelled(jobId)) return;
    let s = 0;
    for (let i = 0; i < p.n; i++) {
      const u = Math.max(rng(), Number.MIN_VALUE);
      s += -Math.log(u) / p.theta;
    }
    const lo = p.qLow / s;
    const hi = p.qHigh / s;
    const mle = p.n / s;
    const hit = lo <= p.theta && p.theta <= hi;
    covered += hit ? 1 : 0;
    sumLen += hi - lo;
    sumMle += mle;
    sumMse += (mle - p.theta) ** 2;
    if (intervals.length < 100) intervals.push({ lo, hi, hit });
    if ((b + 1) % batch === 0 || b + 1 === p.B) {
      const m = b + 1;
      postProgress(jobId, m, p.B, {
        coverage: covered / m,
        length: sumLen / m,
        bias: sumMle / m - p.theta,
        mse: sumMse / m
      });
    }
  }
  postMessage({ type: 'result', jobId, problem: 1, result: {
    coverage: covered / p.B,
    length: sumLen / p.B,
    bias: sumMle / p.B - p.theta,
    mse: sumMse / p.B,
    intervals,
    theta: p.theta
  }});
}

function simulateP2(jobId, p) {
  const rng = mulberry32(p.seed);
  let covered = 0;
  const batch = 500;
  for (let b = 0; b < p.B; b++) {
    if (cancelled(jobId)) return;
    let k = 0;
    for (let i = 0; i < p.n; i++) k += rng() < p.prob ? 1 : 0;
    const phat = k / p.n;
    covered += Math.abs(phat - p.prob) <= p.error + 1e-12 ? 1 : 0;
    if ((b + 1) % batch === 0 || b + 1 === p.B) {
      postProgress(jobId, b + 1, p.B, { coverage: covered / (b + 1) });
    }
  }
  postMessage({ type: 'result', jobId, problem: 2, result: { coverage: covered / p.B }});
}

function simulateP3(jobId, p) {
  const rng = mulberry32(p.seed);
  let mu, variance;
  if (p.dist === 'twopoint') {
    mu = p.param * p.a + (1 - p.param) * p.b;
    variance = p.param * (1 - p.param) * (p.b - p.a) ** 2;
  } else if (p.dist === 'uniform') {
    mu = (p.a + p.b) / 2;
    variance = (p.b - p.a) ** 2 / 12;
  } else {
    const shape = p.shape;
    mu = (p.a + p.b) / 2;
    variance = (p.b - p.a) ** 2 / (4 * (2 * shape + 1));
  }
  let covCon = 0, covHoeff = 0, lenCon = 0, lenHoeff = 0;
  const halfCon = p.z * (p.b - p.a) / (2 * Math.sqrt(p.n));
  const halfHoeff = (p.b - p.a) * Math.sqrt(Math.log(2 / p.alpha) / (2 * p.n));
  const means = [];
  const batch = 500;
  for (let rep = 0; rep < p.B; rep++) {
    if (cancelled(jobId)) return;
    let s = 0;
    for (let i = 0; i < p.n; i++) {
      let x;
      if (p.dist === 'twopoint') x = rng() < p.param ? p.a : p.b;
      else if (p.dist === 'uniform') x = p.a + (p.b - p.a) * rng();
      else x = p.a + (p.b - p.a) * betaSample(p.shape, p.shape, rng);
      s += x;
    }
    const xbar = s / p.n;
    if (means.length < 1500) means.push(xbar);
    covCon += xbar - halfCon <= mu && mu <= xbar + halfCon ? 1 : 0;
    covHoeff += xbar - halfHoeff <= mu && mu <= xbar + halfHoeff ? 1 : 0;
    lenCon += 2 * halfCon;
    lenHoeff += 2 * halfHoeff;
    if ((rep + 1) % batch === 0 || rep + 1 === p.B) {
      postProgress(jobId, rep + 1, p.B, {
        covCon: covCon / (rep + 1), covHoeff: covHoeff / (rep + 1)
      });
    }
  }
  postMessage({ type: 'result', jobId, problem: 3, result: {
    mu, variance, bound: (p.b - p.a) ** 2 / 4,
    covCon: covCon / p.B, covHoeff: covHoeff / p.B,
    lenCon: lenCon / p.B, lenHoeff: lenHoeff / p.B, means
  }});
}

function simulateP4(jobId, p) {
  const rng = mulberry32(p.seed);
  const names = ['Momentos', 'Máxima verosimilitud', 'MLE corregido'];
  const sum = [0, 0, 0], sumSq = [0, 0, 0], mse = [0, 0, 0];
  const samples = [[], [], []];
  const batch = 500;
  for (let rep = 0; rep < p.B; rep++) {
    if (cancelled(jobId)) return;
    let sx = 0, slog = 0;
    for (let i = 0; i < p.n; i++) {
      const u = Math.max(rng(), Number.MIN_VALUE);
      const x = Math.pow(u, 1 / (p.theta + 1));
      sx += x;
      slog += Math.log(x);
    }
    const xbar = sx / p.n;
    const mm = (2 * xbar - 1) / Math.max(1 - xbar, 1e-14);
    const mle = -p.n / slog - 1;
    const corrected = -(p.n - 1) / slog - 1;
    const vals = [mm, mle, corrected];
    for (let j = 0; j < 3; j++) {
      sum[j] += vals[j];
      sumSq[j] += vals[j] ** 2;
      mse[j] += (vals[j] - p.theta) ** 2;
      if (samples[j].length < 2500 && Number.isFinite(vals[j])) samples[j].push(vals[j]);
    }
    if ((rep + 1) % batch === 0 || rep + 1 === p.B) {
      const m = rep + 1;
      postProgress(jobId, m, p.B, { mse: mse.map(v => v / m) });
    }
  }
  const stats = names.map((name, j) => {
    const mean = sum[j] / p.B;
    const variance = Math.max(0, sumSq[j] / p.B - mean ** 2);
    return { name, bias: mean - p.theta, variance, mse: mse[j] / p.B };
  });
  postMessage({ type: 'result', jobId, problem: 4, result: { stats, samples, theta: p.theta }});
}

function simulateP5(jobId, p) {
  const rng = mulberry32(p.seed);
  let exact = 0, percentile = 0, basic = 0, pivotal = 0;
  let mObs = null;
  const alpha = p.alpha;
  const rLow = Math.pow(1 - alpha / 2, -1 / p.n);
  const rHigh = Math.pow(alpha / 2, -1 / p.n);
  const batch = 500;
  for (let rep = 0; rep < p.B; rep++) {
    if (cancelled(jobId)) return;
    const umax = Math.pow(Math.max(rng(), Number.MIN_VALUE), 1 / p.n);
    const m = p.theta / umax;
    if (mObs === null) mObs = m;
    const exLo = m * Math.pow(alpha / 2, 1 / p.n);
    const exHi = m * Math.pow(1 - alpha / 2, 1 / p.n);
    const perLo = m * rLow;
    const perHi = m * rHigh;
    const basLo = 2 * m - perHi;
    const basHi = 2 * m - perLo;
    const pivLo = m / rHigh;
    const pivHi = m / rLow;
    exact += exLo <= p.theta && p.theta <= exHi ? 1 : 0;
    percentile += perLo <= p.theta && p.theta <= perHi ? 1 : 0;
    basic += basLo <= p.theta && p.theta <= basHi ? 1 : 0;
    pivotal += pivLo <= p.theta && p.theta <= pivHi ? 1 : 0;
    if ((rep + 1) % batch === 0 || rep + 1 === p.B) {
      const mrep = rep + 1;
      postProgress(jobId, mrep, p.B, {
        exact: exact / mrep, percentile: percentile / mrep,
        basic: basic / mrep, pivotal: pivotal / mrep
      });
    }
  }
  const bootValues = [];
  for (let i = 0; i < 1800; i++) {
    const ratio = Math.pow(Math.max(rng(), Number.MIN_VALUE), -1 / p.n);
    bootValues.push(mObs * ratio);
  }
  postMessage({ type: 'result', jobId, problem: 5, result: {
    exact: exact / p.B, percentile: percentile / p.B,
    basic: basic / p.B, pivotal: pivotal / p.B,
    mObs, bootValues, theta: p.theta
  }});
}

onmessage = (event) => {
  const { jobId, problem, params } = event.data;
  activeJob = jobId;
  try {
    if (problem === 1) simulateP1(jobId, params);
    else if (problem === 2) simulateP2(jobId, params);
    else if (problem === 3) simulateP3(jobId, params);
    else if (problem === 4) simulateP4(jobId, params);
    else if (problem === 5) simulateP5(jobId, params);
  } catch (error) {
    postMessage({ type: 'error', jobId, message: error instanceof Error ? error.message : String(error) });
  }
};
