'use strict';

const charts = {};
const workers = {};
const palette = {
  accent: '#65f2c2', blue: '#88a7ff', warn: '#ffba72', danger: '#ff7f91',
  text: '#dce9f8', muted: '#8398b0', grid: 'rgba(173,205,235,.10)'
};

Chart.defaults.color = palette.muted;
Chart.defaults.borderColor = palette.grid;
Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui, sans-serif';
Chart.defaults.animation.duration = 300;

const intervalPlugin = {
  id: 'intervalPlugin',
  afterDatasetsDraw(chart) {
    if (!chart.$intervals) return;
    const { ctx, scales: { x, y } } = chart;
    ctx.save();
    chart.$intervals.forEach((interval, index) => {
      const py = y.getPixelForValue(index + 1);
      const color = interval.hit ? palette.accent : palette.danger;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = .82;
      ctx.beginPath();
      ctx.moveTo(x.getPixelForValue(interval.lo), py);
      ctx.lineTo(x.getPixelForValue(interval.hi), py);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x.getPixelForValue((interval.lo + interval.hi) / 2), py, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
    if (Number.isFinite(chart.$theta)) {
      const px = x.getPixelForValue(chart.$theta);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.blue;
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, chart.chartArea.top);
      ctx.lineTo(px, chart.chartArea.bottom);
      ctx.stroke();
    }
    ctx.restore();
  }
};

const verticalLinesPlugin = {
  id: 'verticalLinesPlugin',
  afterDatasetsDraw(chart) {
    if (!chart.$verticalLines) return;
    const { ctx, scales: { x } } = chart;
    ctx.save();
    chart.$verticalLines.forEach(line => {
      const px = x.getPixelForValue(line.value);
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(line.dash || []);
      ctx.beginPath();
      ctx.moveTo(px, chart.chartArea.top);
      ctx.lineTo(px, chart.chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = line.color;
      ctx.font = '700 11px Inter, sans-serif';
      ctx.fillText(line.label, Math.min(px + 6, chart.chartArea.right - 82), chart.chartArea.top + 14 + (line.offset || 0));
    });
    ctx.restore();
  }
};
Chart.register(intervalPlugin, verticalLinesPlugin);

const defaults = {
  1: { 'p1-theta': '2', 'p1-n': '30', 'p1-conf': '95', 'p1-b': '50000', 'p1-seed': '1966' },
  2: { 'p2-n': '752', 'p2-e': '0.03', 'p2-conf': '90', 'p2-p': '0.5', 'p2-b': '50000', 'p2-seed': '1966' },
  3: { 'p3-a': '0', 'p3-b': '1', 'p3-prob': '0.5', 'p3-dist': 'twopoint', 'p3-n': '100', 'p3-conf': '95', 'p3-brep': '50000', 'p3-seed': '1966' },
  4: { 'p4-theta': '2', 'p4-n': '30', 'p4-b': '50000', 'p4-seed': '1966' },
  5: { 'p5-theta': '2', 'p5-n': '20', 'p5-conf': '95', 'p5-b': '1000', 'p5-mode': 'simulated', 'p5-inner': '500', 'p5-seed': '1966' }
};

const metricIds = {
  1: ['p1-nominal', 'p1-coverage', 'p1-mc-error', 'p1-length', 'p1-bias', 'p1-mse'],
  2: ['p2-normal-n', 'p2-hoeffding-n', 'p2-exact', 'p2-mc', 'p2-diff', 'p2-mc-error'],
  3: ['p3-var', 'p3-bound', 'p3-cov-normal', 'p3-cov-hoeff', 'p3-len-normal', 'p3-len-hoeff'],
  4: ['p4-best-bias', 'p4-best-var', 'p4-best-mse'],
  5: [
    'p5-exact', 'p5-percentile', 'p5-basic', 'p5-pivotal',
    'p5-len-exact', 'p5-len-percentile', 'p5-len-basic', 'p5-len-pivotal',
    'p5-demo-m', 'p5-demo-theta', 'p5-demo-q-low', 'p5-demo-q-high'
  ]
};

const chartKeys = {
  1: ['p1'],
  2: ['p2'],
  3: ['p3var', 'p3cov'],
  4: ['p4dist', 'p4mse'],
  5: ['p5demo', 'p5']
};

function el(id) { return document.getElementById(id); }
function num(id) { return Number(el(id).value); }
function pct(value, digits = 2) { return Number.isFinite(value) ? `${(100 * value).toFixed(digits)}%` : '—'; }
function pp(value, digits = 3) { return Number.isFinite(value) ? `${(100 * value).toFixed(digits)} pp` : '—'; }
function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  if (absolute > 0 && (absolute < 1e-3 || absolute >= 1e4)) return value.toExponential(3);
  return value.toFixed(digits);
}

function setProgress(problem, ratio) {
  const bounded = Math.max(0, Math.min(1, ratio));
  const percent = Math.round(bounded * 100);
  el(`p${problem}-progress`).style.width = `${percent}%`;
  el(`p${problem}-progress-text`).textContent = `${percent}%`;
  el(`p${problem}-progress-track`).setAttribute('aria-valuenow', String(percent));
}

function setStatus(problem, message) { el(`p${problem}-status`).textContent = message; }
function reportError(problem, message = '') {
  const box = el(`p${problem}-error`);
  box.textContent = message;
  box.classList.toggle('visible', Boolean(message));
  return Boolean(message);
}

function buttonBusy(problem, busy) {
  const button = el(`run-p${problem}`);
  button.disabled = busy;
  button.dataset.original ||= button.textContent;
  button.textContent = busy ? 'Calculando…' : button.dataset.original;
}

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    delete charts[key];
  }
}

function stopWorker(problem) {
  const worker = workers[problem];
  if (!worker) return;
  worker.onmessage = null;
  worker.onerror = null;
  worker.terminate();
  workers[problem] = null;
  buttonBusy(problem, false);
}

function clearLabOutputs(problem) {
  metricIds[problem].forEach(id => { el(id).textContent = '—'; });
  chartKeys[problem].forEach(destroyChart);
  if (problem === 2) el('p2-worst').textContent = 'Peor cobertura de la malla: —';
  if (problem === 4) el('p4-table').replaceChildren();
  if (problem === 5) {
    el('p5-demo-sample').textContent = '—';
    el('p5-demo-intervals').replaceChildren();
  }
}

function bindRange(inputId, outputId, formatter = value => value) {
  const input = el(inputId);
  const output = el(outputId);
  const update = () => { output.textContent = formatter(input.value); };
  input.addEventListener('input', update);
  update();
}

function validSeed(problem, id) {
  const value = num(id);
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
    reportError(problem, 'La semilla debe ser un entero entre 1 y 2 147 483 647.');
    return false;
  }
  return true;
}

function runWorker(problem, params, onProgress, onResult) {
  stopWorker(problem);
  const worker = new Worker('sim-worker.js');
  workers[problem] = worker;
  const jobId = `${problem}-${Date.now()}-${Math.random()}`;
  buttonBusy(problem, true);
  setProgress(problem, 0);
  setStatus(problem, 'Simulación en curso; la interfaz permanece disponible.');
  worker.onmessage = event => {
    const message = event.data;
    if (message.jobId !== jobId) return;
    if (message.type === 'progress') {
      setProgress(problem, message.completed / message.total);
      onProgress?.(message.partial, message);
    } else if (message.type === 'result') {
      setProgress(problem, 1);
      buttonBusy(problem, false);
      onResult(message.result);
      setStatus(problem, 'Simulación finalizada con los valores mostrados.');
      worker.terminate();
      workers[problem] = null;
    } else if (message.type === 'error') {
      buttonBusy(problem, false);
      reportError(problem, `No fue posible completar el cálculo: ${message.message}`);
      setStatus(problem, 'La simulación se detuvo por un error.');
      worker.terminate();
      workers[problem] = null;
    }
  };
  worker.onerror = event => {
    buttonBusy(problem, false);
    reportError(problem, `Error del proceso de simulación: ${event.message}`);
    setStatus(problem, 'La simulación se detuvo por un error.');
    worker.terminate();
    workers[problem] = null;
  };
  worker.postMessage({ jobId, problem, params });
}

function showP1Partial(partial, completed) {
  el('p1-coverage').textContent = pct(partial.coverage, 3);
  el('p1-mc-error').textContent = pp(Math.sqrt(partial.coverage * (1 - partial.coverage) / completed), 3);
  el('p1-length').textContent = fmt(partial.length);
  el('p1-bias').textContent = fmt(partial.bias);
  el('p1-mse').textContent = fmt(partial.mse);
}

function runP1() {
  reportError(1);
  if (!validSeed(1, 'p1-seed')) return;
  const theta = num('p1-theta');
  const n = num('p1-n');
  const confidence = num('p1-conf') / 100;
  const B = num('p1-b');
  const seed = num('p1-seed');
  if (!(theta > 0) || !(n >= 2) || !(B >= 1000)) {
    reportError(1, 'Use θ > 0, n ≥ 2 y al menos 1 000 réplicas.');
    return;
  }
  const alpha = 1 - confidence;
  const qLow = jStat.gamma.inv(alpha / 2, n, 1);
  const qHigh = jStat.gamma.inv(1 - alpha / 2, n, 1);
  el('p1-nominal').textContent = pct(confidence);
  runWorker(1, { theta, n, B, seed, qLow, qHigh }, (partial, message) => {
    showP1Partial(partial, message.completed);
  }, result => {
    showP1Partial(result, B);
    const mids = result.intervals.map((interval, index) => ({ x: (interval.lo + interval.hi) / 2, y: index + 1 }));
    const lows = result.intervals.map(interval => interval.lo);
    const highs = result.intervals.map(interval => interval.hi);
    destroyChart('p1');
    charts.p1 = new Chart(el('p1-chart'), {
      type: 'scatter',
      data: { datasets: [{ data: mids, pointRadius: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { min: Math.min(...lows, theta) * .94, max: Math.max(...highs, theta) * 1.06, title: { display: true, text: 'Valores del parámetro θ' }, grid: { color: palette.grid } },
          y: { min: 0, max: result.intervals.length + 1, ticks: { display: false }, title: { display: true, text: 'Primeras 100 réplicas' }, grid: { display: false } }
        }
      }
    });
    charts.p1.$intervals = result.intervals;
    charts.p1.$theta = theta;
    charts.p1.update();
  });
}

function exactBinomialCoverage(n, probability, error) {
  if (probability <= 0 || probability >= 1) return 1;
  const lo = Math.max(0, Math.ceil(n * (probability - error) - 1e-10));
  const hi = Math.min(n, Math.floor(n * (probability + error) + 1e-10));
  if (lo > hi) return 0;
  const upper = jStat.binomial.cdf(hi, n, probability);
  const lower = lo > 0 ? jStat.binomial.cdf(lo - 1, n, probability) : 0;
  return Math.max(0, Math.min(1, upper - lower));
}

function showP2Simulation(coverage, exact, completed) {
  el('p2-mc').textContent = pct(coverage, 3);
  el('p2-diff').textContent = pp(coverage - exact, 3);
  el('p2-mc-error').textContent = pp(Math.sqrt(coverage * (1 - coverage) / completed), 3);
}

function runP2() {
  reportError(2);
  if (!validSeed(2, 'p2-seed')) return;
  const n = num('p2-n');
  const error = num('p2-e');
  const confidence = num('p2-conf') / 100;
  const probability = num('p2-p');
  const B = num('p2-b');
  const seed = num('p2-seed');
  if (!(n >= 1) || !(error > 0 && error < 1) || !(probability > 0 && probability < 1) || !(B >= 1000)) {
    reportError(2, 'Revise que n ≥ 1, 0 < E < 1, 0 < θ < 1 y B ≥ 1 000.');
    return;
  }
  const alpha = 1 - confidence;
  const z = jStat.normal.inv(1 - alpha / 2, 0, 1);
  const normalN = Math.ceil(z * z * .25 / (error * error));
  const hoeffdingN = Math.ceil(Math.log(2 / alpha) / (2 * error * error));
  const exactSelected = exactBinomialCoverage(n, probability, error);
  el('p2-normal-n').textContent = String(normalN);
  el('p2-hoeffding-n').textContent = String(hoeffdingN);
  el('p2-exact').textContent = pct(exactSelected, 4);

  const points = [];
  let worst = { p: 0, c: 1 };
  for (let index = 0; index <= 400; index++) {
    const p = index / 400;
    const coverage = exactBinomialCoverage(n, p, error);
    points.push({ x: p, y: coverage * 100 });
    if (coverage < worst.c) worst = { p, c: coverage };
  }
  el('p2-worst').textContent = `Peor cobertura de la malla: ${pct(worst.c, 3)} cerca de θ=${worst.p.toFixed(3)}.`;
  destroyChart('p2');
  charts.p2 = new Chart(el('p2-chart'), {
    type: 'line',
    data: { datasets: [
      { label: 'Cobertura binomial exacta', data: points, parsing: false, borderColor: palette.accent, backgroundColor: 'rgba(101,242,194,.09)', pointRadius: 0, borderWidth: 2, tension: 0 },
      { label: 'Objetivo nominal', data: [{ x: 0, y: confidence * 100 }, { x: 1, y: confidence * 100 }], parsing: false, borderColor: palette.warn, borderDash: [7, 6], pointRadius: 0, borderWidth: 2 }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { type: 'linear', min: 0, max: 1, title: { display: true, text: 'Proporción verdadera θ' }, grid: { color: palette.grid } },
        y: { min: Math.max(0, worst.c * 100 - 1.5), max: 100, title: { display: true, text: 'Probabilidad de cobertura (%)' }, grid: { color: palette.grid } }
      }
    }
  });
  runWorker(2, { n, prob: probability, error, B, seed }, (partial, message) => {
    showP2Simulation(partial.coverage, exactSelected, message.completed);
  }, result => {
    showP2Simulation(result.coverage, exactSelected, B);
  });
}

function buildP3VarianceChart(a, b, probability) {
  const bound = (b - a) ** 2 / 4;
  const curve = [];
  for (let index = 0; index <= 100; index++) {
    const p = index / 100;
    curve.push({ x: p, y: p * (1 - p) * (b - a) ** 2 });
  }
  destroyChart('p3var');
  charts.p3var = new Chart(el('p3-var-chart'), {
    type: 'line',
    data: { datasets: [
      { label: 'p(1-p)(b-a)²', data: curve, parsing: false, borderColor: palette.blue, backgroundColor: 'rgba(136,167,255,.10)', fill: true, pointRadius: 0, borderWidth: 2, tension: .15 },
      { label: 'p seleccionado', data: [{ x: probability, y: probability * (1 - probability) * (b - a) ** 2 }], parsing: false, borderColor: palette.accent, backgroundColor: palette.accent, pointRadius: 7 },
      { label: 'Cota (b-a)²/4', data: [{ x: 0, y: bound }, { x: 1, y: bound }], parsing: false, borderColor: palette.warn, borderDash: [7, 6], pointRadius: 0, borderWidth: 2 }
    ] },
    options: { responsive: true, maintainAspectRatio: false, scales: {
      x: { type: 'linear', min: 0, max: 1, title: { display: true, text: 'p = P(X=a)' }, grid: { color: palette.grid } },
      y: { beginAtZero: true, title: { display: true, text: 'Varianza' }, grid: { color: palette.grid } }
    } }
  });
}

function buildP3CoverageChart(result, confidence) {
  destroyChart('p3cov');
  charts.p3cov = new Chart(el('p3-cov-chart'), {
    type: 'bar',
    data: {
      labels: ['Conservador (TCL)', 'Hoeffding'],
      datasets: [
        { label: 'Intervalos que contienen a μ', data: [result.covCon * 100, result.covHoeff * 100], backgroundColor: [palette.blue, palette.warn], borderColor: [palette.blue, palette.warn], borderWidth: 1 },
        { type: 'line', label: 'Nivel nominal', data: [confidence * 100, confidence * 100], borderColor: palette.danger, borderDash: [7, 6], pointRadius: 0, borderWidth: 2 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: Math.max(0, confidence * 100 - 6), max: 100, title: { display: true, text: 'Probabilidad de cobertura (%)' }, grid: { color: palette.grid } } } }
  });
}

function runP3() {
  reportError(3);
  if (!validSeed(3, 'p3-seed')) return;
  const a = num('p3-a');
  const b = num('p3-b');
  const probability = num('p3-prob');
  const dist = el('p3-dist').value;
  const n = num('p3-n');
  const confidence = num('p3-conf') / 100;
  const B = num('p3-brep');
  const seed = num('p3-seed');
  if (!(b > a)) {
    reportError(3, 'El extremo b debe ser estrictamente mayor que a.');
    return;
  }
  if (!(n >= 2) || !(B >= 1000)) {
    reportError(3, 'Use n ≥ 2 y al menos 1 000 réplicas.');
    return;
  }
  const alpha = 1 - confidence;
  const z = jStat.normal.inv(1 - alpha / 2, 0, 1);
  const selectedVariance = probability * (1 - probability) * (b - a) ** 2;
  const bound = (b - a) ** 2 / 4;
  el('p3-var').textContent = fmt(selectedVariance);
  el('p3-bound').textContent = fmt(bound);
  buildP3VarianceChart(a, b, probability);
  runWorker(3, { a, b, dist, param: .5, shape: 4, n, B, alpha, z, seed }, partial => {
    el('p3-cov-normal').textContent = pct(partial.covCon);
    el('p3-cov-hoeff').textContent = pct(partial.covHoeff);
  }, result => {
    el('p3-cov-normal').textContent = pct(result.covCon);
    el('p3-cov-hoeff').textContent = pct(result.covHoeff);
    el('p3-len-normal').textContent = fmt(result.lenCon);
    el('p3-len-hoeff').textContent = fmt(result.lenHoeff);
    buildP3CoverageChart(result, confidence);
  });
}

function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function histogram(values, min, max, bins) {
  const counts = Array(bins).fill(0);
  const width = (max - min) / bins || 1;
  values.forEach(value => {
    if (value < min || value > max || !Number.isFinite(value)) return;
    const index = Math.min(bins - 1, Math.floor((value - min) / width));
    counts[index]++;
  });
  const total = values.length || 1;
  return counts.map((count, index) => ({ x: min + (index + .5) * width, y: count / total / width }));
}

function buildP4Charts(result, theta) {
  const combined = result.samples.flat().filter(Number.isFinite).sort((a, b) => a - b);
  const min = quantile(combined, .01);
  const max = quantile(combined, .99);
  const colors = [palette.warn, palette.blue, palette.accent];
  const distributions = result.samples.map((sample, index) => ({
    label: result.stats[index].name,
    data: histogram(sample, min, max, 38), parsing: false,
    borderColor: colors[index], backgroundColor: `${colors[index]}35`, borderWidth: 1.4,
    pointRadius: 0, fill: true, tension: .16
  }));
  destroyChart('p4dist');
  charts.p4dist = new Chart(el('p4-dist-chart'), {
    type: 'line', data: { datasets: distributions },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false }, scales: {
      x: { type: 'linear', min, max, title: { display: true, text: 'Valor del estimador' }, grid: { color: palette.grid } },
      y: { beginAtZero: true, title: { display: true, text: 'Densidad empírica' }, grid: { color: palette.grid } }
    } }
  });
  charts.p4dist.$verticalLines = [{ value: theta, label: 'θ verdadero', color: palette.danger, dash: [6, 5] }];
  charts.p4dist.update();

  const curveDatasets = result.stats.map((stat, index) => ({
    label: stat.name,
    data: result.mseCurve.map(point => ({ x: point.n, y: point.mse[index] })),
    parsing: false, borderColor: colors[index], backgroundColor: colors[index], pointRadius: 4, borderWidth: 2, tension: .15
  }));
  destroyChart('p4mse');
  charts.p4mse = new Chart(el('p4-mse-chart'), {
    type: 'line', data: { datasets: curveDatasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false }, scales: {
      x: { type: 'linear', title: { display: true, text: 'Tamaño de muestra n' }, grid: { color: palette.grid } },
      y: { type: 'logarithmic', title: { display: true, text: 'Error cuadrático medio' }, grid: { color: palette.grid } }
    } }
  });
}

function runP4() {
  reportError(4);
  if (!validSeed(4, 'p4-seed')) return;
  const theta = num('p4-theta');
  const n = num('p4-n');
  const B = num('p4-b');
  const seed = num('p4-seed');
  if (!(theta > -1) || !(n > 1) || !(B >= 1000)) {
    reportError(4, 'Use θ > −1, n > 1 y al menos 1 000 réplicas.');
    return;
  }
  runWorker(4, { theta, n, B, seed, sizes: [5, 10, 20, 40, 80, 150] }, partial => {
    if (partial.phase === 'distribution') {
      setStatus(4, `Fase 1 de 2: distribución empírica para n=${n}.`);
    } else if (partial.phase === 'mse') {
      setStatus(4, `Fase 2 de 2: curva de ECM; procesando n=${partial.size}.`);
    }
  }, result => {
    const byBias = [...result.stats].sort((a, b) => Math.abs(a.bias) - Math.abs(b.bias))[0];
    const byVariance = [...result.stats].sort((a, b) => a.variance - b.variance)[0];
    const byMse = [...result.stats].sort((a, b) => a.mse - b.mse)[0];
    el('p4-best-bias').textContent = byBias.name;
    el('p4-best-var').textContent = byVariance.name;
    el('p4-best-mse').textContent = byMse.name;
    el('p4-table').innerHTML = result.stats.map(stat => `<tr><td>${stat.name}</td><td>${fmt(stat.bias)}</td><td>${fmt(stat.variance)}</td><td>${fmt(stat.variance + stat.bias ** 2)}</td><td>${fmt(stat.mse)}</td></tr>`).join('');
    buildP4Charts(result, theta);
  });
}

function showP5Partial(partial) {
  el('p5-exact').textContent = pct(partial.exact);
  el('p5-percentile').textContent = pct(partial.percentile);
  el('p5-basic').textContent = pct(partial.basic);
  el('p5-pivotal').textContent = pct(partial.pivotal);
  if (Number.isFinite(partial.lenExact)) el('p5-len-exact').textContent = fmt(partial.lenExact);
  if (Number.isFinite(partial.lenPercentile)) el('p5-len-percentile').textContent = fmt(partial.lenPercentile);
  if (Number.isFinite(partial.lenBasic)) el('p5-len-basic').textContent = fmt(partial.lenBasic);
  if (Number.isFinite(partial.lenPivotal)) el('p5-len-pivotal').textContent = fmt(partial.lenPivotal);
}

function buildP5Chart(result, confidence) {
  destroyChart('p5');
  charts.p5 = new Chart(el('p5-chart'), {
    type: 'bar',
    data: {
      labels: ['Exacto', 'Percentil', 'Básico', 'Pivotal'],
      datasets: [
        { label: 'Intervalos que contienen a θ', data: [result.exact * 100, result.percentile * 100, result.basic * 100, result.pivotal * 100], backgroundColor: [palette.blue, palette.danger, palette.warn, palette.accent], borderColor: [palette.blue, palette.danger, palette.warn, palette.accent], borderWidth: 1 },
        { type: 'line', label: 'Nivel nominal', data: [confidence * 100, confidence * 100, confidence * 100, confidence * 100], borderColor: palette.danger, borderDash: [7, 6], pointRadius: 0, borderWidth: 2 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100, title: { display: true, text: 'Probabilidad de cobertura (%)' }, grid: { color: palette.grid } } } }
  });
}

function buildP5DemoChart(showcase, theta) {
  const values = showcase.bootstrapMinima.filter(Number.isFinite).sort((a, b) => a - b);
  const min = values[0];
  const max = values[values.length - 1];
  destroyChart('p5demo');
  charts.p5demo = new Chart(el('p5-demo-chart'), {
    type: 'line',
    data: { datasets: [{
      label: 'Distribución bootstrap de M*',
      data: histogram(values, min, max, 34),
      parsing: false,
      borderColor: palette.accent,
      backgroundColor: 'rgba(101,242,194,.14)',
      borderWidth: 2,
      pointRadius: 0,
      fill: true,
      tension: .15
    }] },
    options: { responsive: true, maintainAspectRatio: false, scales: {
      x: { type: 'linear', title: { display: true, text: 'Mínimo bootstrap M*' }, grid: { color: palette.grid } },
      y: { beginAtZero: true, title: { display: true, text: 'Densidad empírica' }, grid: { color: palette.grid } }
    } }
  });
  charts.p5demo.$verticalLines = [
    { value: showcase.minimum, label: 'M = θ̂', color: palette.blue, dash: [6, 5] },
    { value: theta, label: 'θ verdadero', color: palette.danger, dash: [3, 4], offset: 16 }
  ];
  charts.p5demo.update();

  el('p5-demo-m').textContent = fmt(showcase.minimum);
  el('p5-demo-theta').textContent = fmt(showcase.minimum);
  el('p5-demo-q-low').textContent = fmt(showcase.qLow);
  el('p5-demo-q-high').textContent = fmt(showcase.qHigh);
  const preview = showcase.sample.slice(0, 8).map(value => fmt(value, 3)).join(', ');
  el('p5-demo-sample').textContent = `${preview}${showcase.sample.length > 8 ? ', …' : ''}`;
  const methodLabels = {
    exact: 'Exacto', percentile: 'Percentil', basic: 'Básico', pivotal: 'Pivotal'
  };
  el('p5-demo-intervals').innerHTML = Object.entries(showcase.intervals).map(([method, interval]) => (
    `<tr><td>${methodLabels[method]}</td><td>[${fmt(interval.lo)}, ${fmt(interval.hi)}]</td><td>${interval.lo <= theta && theta <= interval.hi ? 'Sí' : 'No'}</td></tr>`
  )).join('');
}

function updateP5ModeControls(useRecommendedValues) {
  const simulated = el('p5-mode').value === 'simulated';
  const outer = el('p5-b');
  const inner = el('p5-inner');
  outer.min = simulated ? '200' : '1000';
  outer.max = simulated ? '5000' : '50000';
  outer.step = simulated ? '200' : '1000';
  inner.min = simulated ? '200' : '1000';
  inner.max = simulated ? '2000' : '20000';
  inner.step = simulated ? '100' : '1000';
  if (useRecommendedValues) {
    outer.value = simulated ? '1000' : '40000';
    inner.value = simulated ? '500' : '10000';
    outer.dispatchEvent(new Event('input', { bubbles: true }));
    inner.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el('p5-outer-caption').textContent = simulated
    ? 'R: muestras exteriores (200–5 000)'
    : 'R: muestras exteriores (1 000–50 000)';
  el('p5-inner-caption').textContent = simulated
    ? 'B*: réplicas bootstrap por cada muestra exterior'
    : 'B*: réplicas para calibrar M*/M una sola vez';
  el('p5-mode-note').textContent = simulated
    ? 'Bootstrap paramétrico simulado: para cada muestra exterior se ajusta θ̂=M y se generan B* muestras desde f(x;M).'
    : 'La versión acelerada sigue siendo bootstrap paramétrico. Aprovecha que la razón M*/M tiene una distribución independiente del valor ajustado, por lo que sus cuantiles pueden calibrarse una vez y reutilizarse.';
  el('p5-progress-detail').textContent = simulated
    ? `R exterior: 0/${outer.value} · B*: 0/${inner.value}`
    : `Calibración pivotal: 0/${inner.value} · R exterior: 0/${outer.value}`;
}

function runP5() {
  reportError(5);
  if (!validSeed(5, 'p5-seed')) return;
  const theta = num('p5-theta');
  const n = num('p5-n');
  const confidence = num('p5-conf') / 100;
  const R = num('p5-b');
  const mode = el('p5-mode').value;
  const inner = num('p5-inner');
  const seed = num('p5-seed');
  if (!(theta > 0) || !(n > 1)) {
    reportError(5, 'Use θ > 0 y n > 1; esta condición es necesaria para que E[M] sea finita.');
    return;
  }
  if (mode === 'simulated' && (!(R >= 200 && R <= 5000) || !(inner >= 200 && inner <= 2000) || R * inner > 5000000 || R * inner * n > 25000000)) {
    reportError(5, 'En el modo simulado use 200 ≤ R ≤ 5 000, 200 ≤ B* ≤ 2 000, R×B* ≤ 5 000 000 y R×B*×n ≤ 25 000 000.');
    return;
  }
  if (mode === 'accelerated' && (!(R >= 1000 && R <= 50000) || !(inner >= 1000 && inner <= 20000))) {
    reportError(5, 'En la versión acelerada use 1 000 ≤ R ≤ 50 000 y 1 000 ≤ B* ≤ 20 000.');
    return;
  }
  const alpha = 1 - confidence;
  runWorker(5, { theta, n, R, seed, alpha, mode, inner }, (partial, message) => {
    if (partial.phase === 'bootstrap') {
      el('p5-progress-detail').textContent = `R exterior: ${partial.outerCompleted}/${partial.outerTotal} · B*: ${partial.innerCompleted}/${partial.innerTotal}`;
      setStatus(5, 'Bootstrap paramétrico interior en curso; la página permanece disponible.');
    } else if (partial.phase === 'calibration') {
      el('p5-progress-detail').textContent = `Calibración pivotal: ${partial.innerCompleted}/${partial.innerTotal} · R exterior: 0/${partial.outerTotal}`;
      setStatus(5, 'Calibrando una vez la distribución pivotal M*/M.');
    } else if (partial.phase === 'outer') {
      const prefix = mode === 'simulated' ? `B*: ${inner}/${inner}` : `Calibración pivotal: ${inner}/${inner}`;
      el('p5-progress-detail').textContent = `${prefix} · R exterior: ${partial.outerCompleted}/${partial.outerTotal}`;
      setStatus(5, 'Evaluando la frecuencia de inclusión y la longitud en muestras exteriores.');
    }
    if (Number.isFinite(partial.exact)) showP5Partial(partial);
  }, result => {
    showP5Partial(result);
    buildP5Chart(result, confidence);
    buildP5DemoChart(result.showcase, theta);
    el('p5-progress-detail').textContent = mode === 'simulated'
      ? `R exterior: ${R}/${R} · B*: ${inner}/${inner} en cada muestra`
      : `Calibración pivotal: ${inner}/${inner} · R exterior: ${R}/${R}`;
  });
}

const runners = { 1: runP1, 2: runP2, 3: runP3, 4: runP4, 5: runP5 };

function resetLab(problem) {
  stopWorker(problem);
  Object.entries(defaults[problem]).forEach(([id, value]) => {
    el(id).value = value;
    el(id).dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (problem === 5) updateP5ModeControls(false);
  reportError(problem);
  setProgress(problem, 0);
  clearLabOutputs(problem);
  setStatus(problem, 'Valores predeterminados restablecidos');
}

function setupTabs() {
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      const labMain = button.closest('.lab-main');
      labMain.querySelectorAll('.tab-button').forEach(candidate => {
        const active = candidate === button;
        candidate.classList.toggle('active', active);
        candidate.setAttribute('aria-selected', String(active));
      });
      labMain.querySelectorAll('.tab-panel').forEach(panel => {
        const active = panel.id === button.dataset.tab;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      });
    });
  });
}

function setupBindings() {
  bindRange('p1-theta', 'p1-theta-out', value => Number(value).toFixed(1));
  bindRange('p1-n', 'p1-n-out');
  bindRange('p1-conf', 'p1-conf-out', value => `${value}%`);
  bindRange('p1-b', 'p1-b-out');
  bindRange('p2-n', 'p2-n-out');
  bindRange('p2-e', 'p2-e-out', value => Number(value).toFixed(3));
  bindRange('p2-conf', 'p2-conf-out', value => `${value}%`);
  bindRange('p2-p', 'p2-p-out', value => Number(value).toFixed(2));
  bindRange('p2-b', 'p2-b-out');
  bindRange('p3-a', 'p3-a-out', value => Number(value).toFixed(1));
  bindRange('p3-b', 'p3-b-out', value => Number(value).toFixed(1));
  bindRange('p3-prob', 'p3-prob-out', value => Number(value).toFixed(2));
  bindRange('p3-n', 'p3-n-out');
  bindRange('p3-conf', 'p3-conf-out', value => `${value}%`);
  bindRange('p3-brep', 'p3-brep-out');
  bindRange('p4-theta', 'p4-theta-out', value => Number(value).toFixed(1));
  bindRange('p4-n', 'p4-n-out');
  bindRange('p4-b', 'p4-b-out');
  bindRange('p5-theta', 'p5-theta-out', value => Number(value).toFixed(1));
  bindRange('p5-n', 'p5-n-out');
  bindRange('p5-conf', 'p5-conf-out', value => `${value}%`);
  bindRange('p5-b', 'p5-b-out');
  bindRange('p5-inner', 'p5-inner-out');

  el('p5-mode').addEventListener('change', () => {
    stopWorker(5);
    updateP5ModeControls(true);
    reportError(5);
    setProgress(5, 0);
    clearLabOutputs(5);
    setStatus(5, 'Modo actualizado; listo para ejecutar');
  });
  updateP5ModeControls(false);

  const updateP3Variance = () => {
    const a = num('p3-a');
    const b = num('p3-b');
    const probability = num('p3-prob');
    if (!(b > a)) return;
    el('p3-var').textContent = fmt(probability * (1 - probability) * (b - a) ** 2);
    el('p3-bound').textContent = fmt((b - a) ** 2 / 4);
    buildP3VarianceChart(a, b, probability);
  };
  ['p3-a', 'p3-b', 'p3-prob'].forEach(id => el(id).addEventListener('input', updateP3Variance));

  document.querySelectorAll('.new-seed').forEach(button => {
    button.addEventListener('click', () => {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      el(button.dataset.seed).value = String(1 + (values[0] % 2147483646));
    });
  });
  document.querySelectorAll('.reset-button').forEach(button => button.addEventListener('click', () => resetLab(Number(button.dataset.reset))));
  Object.entries(runners).forEach(([problem, runner]) => el(`run-p${problem}`).addEventListener('click', runner));
  setupTabs();
}

window.addEventListener('DOMContentLoaded', () => {
  setupBindings();
  for (let problem = 1; problem <= 5; problem++) {
    clearLabOutputs(problem);
    setProgress(problem, 0);
    setStatus(problem, 'Listo para ejecutar');
  }
  updateP5ModeControls(false);
});

window.addEventListener('beforeunload', () => {
  Object.keys(workers).forEach(problem => stopWorker(Number(problem)));
});
