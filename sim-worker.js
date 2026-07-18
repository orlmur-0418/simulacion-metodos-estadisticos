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

function paretoSample(scale, n, random, keepValues = false) {
  let minimum = Infinity;
  const sample = keepValues ? [] : null;
  for (let index = 0; index < n; index++) {
    const value = scale / Math.max(random(), Number.MIN_VALUE);
    minimum = Math.min(minimum, value);
    if (sample) sample.push(value);
  }
  return { minimum, sample };
}

function p5Intervals(minimum, alpha, n, qLow, qHigh, ratioLow, ratioHigh) {
  return {
    exact: {
      lo: minimum * Math.pow(alpha / 2, 1 / n),
      hi: minimum * Math.pow(1 - alpha / 2, 1 / n)
    },
    percentile: { lo: qLow, hi: qHigh },
    basic: { lo: 2 * minimum - qHigh, hi: 2 * minimum - qLow },
    pivotal: { lo: minimum / ratioHigh, hi: minimum / ratioLow }
  };
}

function simulateP5(jobId, params) {
  const random = mulberry32(params.seed);
  const methods = ['exact', 'percentile', 'basic', 'pivotal'];
  const counts = Object.fromEntries(methods.map(method => [method, 0]));
  const lengths = Object.fromEntries(methods.map(method => [method, 0]));
  const total = params.mode === 'simulated'
    ? params.R * (params.inner + 1)
    : params.inner + params.R;
  const outerReportStep = Math.max(1, Math.floor(params.R / 100));
  let showcase = null;
  let calibratedRatios = null;
  let calibratedLow = null;
  let calibratedHigh = null;

  if (params.mode === 'accelerated') {
    calibratedRatios = [];
    const calibrationReportStep = Math.max(100, Math.floor(params.inner / 20));
    for (let index = 0; index < params.inner; index++) {
      if (cancelled(jobId)) return;
      calibratedRatios.push(paretoSample(1, params.n, random).minimum);
      if ((index + 1) % calibrationReportStep === 0 || index + 1 === params.inner) {
        postProgress(jobId, index + 1, total, {
          phase: 'calibration',
          innerCompleted: index + 1,
          innerTotal: params.inner,
          outerTotal: params.R
        });
      }
    }
    calibratedRatios.sort((a, b) => a - b);
    calibratedLow = sampleQuantile(calibratedRatios, params.alpha / 2);
    calibratedHigh = sampleQuantile(calibratedRatios, 1 - params.alpha / 2);
  }

  for (let replicate = 0; replicate < params.R; replicate++) {
    if (cancelled(jobId)) return;
    const original = paretoSample(params.theta, params.n, random, replicate === 0);
    const minimum = original.minimum;
    let bootstrapMinima;
    let qLow;
    let qHigh;
    let ratioLow;
    let ratioHigh;

    if (params.mode === 'simulated') {
      bootstrapMinima = [];
      const reportThisOuter = replicate === 0 || (replicate + 1) % outerReportStep === 0 || replicate + 1 === params.R;
      const innerReportStep = Math.max(50, Math.floor(params.inner / 4));
      for (let innerIndex = 0; innerIndex < params.inner; innerIndex++) {
        if (cancelled(jobId)) return;
        bootstrapMinima.push(paretoSample(minimum, params.n, random).minimum);
        if (reportThisOuter && ((innerIndex + 1) % innerReportStep === 0 || innerIndex + 1 === params.inner)) {
          const completed = replicate * (params.inner + 1) + 1 + innerIndex + 1;
          postProgress(jobId, completed, total, {
            phase: 'bootstrap',
            outerCompleted: replicate,
            outerTotal: params.R,
            innerCompleted: innerIndex + 1,
            innerTotal: params.inner
          });
        }
      }
      bootstrapMinima.sort((a, b) => a - b);
      qLow = sampleQuantile(bootstrapMinima, params.alpha / 2);
      qHigh = sampleQuantile(bootstrapMinima, 1 - params.alpha / 2);
      ratioLow = qLow / minimum;
      ratioHigh = qHigh / minimum;
    } else {
      ratioLow = calibratedLow;
      ratioHigh = calibratedHigh;
      qLow = minimum * ratioLow;
      qHigh = minimum * ratioHigh;
      if (replicate === 0) {
        bootstrapMinima = calibratedRatios.slice(0, 2000).map(ratio => minimum * ratio);
      }
    }

    const intervals = p5Intervals(minimum, params.alpha, params.n, qLow, qHigh, ratioLow, ratioHigh);
    for (const method of methods) {
      const interval = intervals[method];
      counts[method] += interval.lo <= params.theta && params.theta <= interval.hi ? 1 : 0;
      lengths[method] += interval.hi - interval.lo;
    }
    if (replicate === 0) {
      showcase = {
        sample: original.sample,
        minimum,
        bootstrapMinima: bootstrapMinima.slice(0, 2000),
        qLow,
        qHigh,
        intervals
      };
    }

    if ((replicate + 1) % outerReportStep === 0 || replicate + 1 === params.R) {
      const denominator = replicate + 1;
      const completed = params.mode === 'simulated'
        ? (replicate + 1) * (params.inner + 1)
        : params.inner + replicate + 1;
      postProgress(jobId, completed, total, {
        phase: 'outer',
        outerCompleted: denominator,
        outerTotal: params.R,
        exact: counts.exact / denominator,
        percentile: counts.percentile / denominator,
        basic: counts.basic / denominator,
        pivotal: counts.pivotal / denominator,
        lenExact: lengths.exact / denominator,
        lenPercentile: lengths.percentile / denominator,
        lenBasic: lengths.basic / denominator,
        lenPivotal: lengths.pivotal / denominator
      });
    }
  }

  postMessage({ type: 'result', jobId, problem: 5, result: {
    exact: counts.exact / params.R,
    percentile: counts.percentile / params.R,
    basic: counts.basic / params.R,
    pivotal: counts.pivotal / params.R,
    lenExact: lengths.exact / params.R,
    lenPercentile: lengths.percentile / params.R,
    lenBasic: lengths.basic / params.R,
    lenPivotal: lengths.pivotal / params.R,
    mode: params.mode,
    showcase
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
