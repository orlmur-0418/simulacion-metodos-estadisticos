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
Chart.defaults.animation.duration = 350;

const intervalPlugin = {
  id: 'intervalPlugin',
  afterDatasetsDraw(chart) {
    if (!chart.$intervals) return;
    const { ctx, scales: { x, y } } = chart;
    ctx.save();
    chart.$intervals.forEach((d, i) => {
      const py = y.getPixelForValue(i + 1);
      ctx.strokeStyle = d.hit ? palette.accent : palette.danger;
      ctx.lineWidth = 2;
      ctx.globalAlpha = .8;
      ctx.beginPath();
      ctx.moveTo(x.getPixelForValue(d.lo), py);
      ctx.lineTo(x.getPixelForValue(d.hi), py);
      ctx.stroke();
      ctx.fillStyle = d.hit ? palette.accent : palette.danger;
      ctx.beginPath();
      ctx.arc(x.getPixelForValue((d.lo + d.hi) / 2), py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
    if (Number.isFinite(chart.$theta)) {
      const px = x.getPixelForValue(chart.$theta);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.blue;
      ctx.setLineDash([5, 5]);
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
      ctx.fillText(line.label, Math.min(px + 6, chart.chartArea.right - 70), chart.chartArea.top + 14 + (line.offset || 0));
    });
    ctx.restore();
  }
};
Chart.register(intervalPlugin, verticalLinesPlugin);

function el(id) { return document.getElementById(id); }
function num(id) { return Number(el(id).value); }
function pct(x, digits = 2) { return Number.isFinite(x) ? `${(100 * x).toFixed(digits)}%` : '—'; }
function fmt(x, digits = 4) {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a > 0 && (a < 1e-3 || a >= 1e4)) return x.toExponential(3);
  return x.toFixed(digits);
}
function setProgress(problem, ratio) { el(`p${problem}-progress`).style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`; }
function buttonBusy(problem, busy) {
  const button = el(`run-p${problem}`);
  if (!button) return;
  button.disabled = busy;
  button.dataset.original ||= button.textContent;
  button.textContent = busy ? 'Calculando…' : button.dataset.original;
}
function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

function bindRange(inputId, outputId, formatter = v => v) {
  const input = el(inputId), output = el(outputId);
  const update = () => { output.textContent = formatter(input.value); };
  input.addEventListener('input', update);
  update();
}

function runWorker(problem, params, onProgress, onResult) {
  if (workers[problem]) workers[problem].terminate();
  const worker = new Worker('sim-worker.js');
  workers[problem] = worker;
  const jobId = `${problem}-${Date.now()}-${Math.random()}`;
  buttonBusy(problem, true);
  setProgress(problem, 0);
  worker.onmessage = (event) => {
    const message = event.data;
    if (message.jobId !== jobId) return;
    if (message.type === 'progress') {
      setProgress(problem, message.completed / message.total);
      onProgress?.(message.partial);
    } else if (message.type === 'result') {
      setProgress(problem, 1);
      buttonBusy(problem, false);
      onResult(message.result);
      worker.terminate();
      workers[problem] = null;
    } else if (message.type === 'error') {
      buttonBusy(problem, false);
      console.error(message.message);
      worker.terminate();
      workers[problem] = null;
    }
  };
  worker.postMessage({ jobId, problem, params });
}

function runP1() {
  const theta = num('p1-theta'), n = num('p1-n'), confidence = num('p1-conf') / 100;
  const alpha = 1 - confidence, B = num('p1-b'), seed = num('p1-seed');
  const qLow = jStat.gamma.inv(alpha / 2, n, 1);
  const qHigh = jStat.gamma.inv(1 - alpha / 2, n, 1);
  el('p1-nominal').textContent = pct(confidence);
  runWorker(1, { theta, n, B, seed, qLow, qHigh }, partial => {
    el('p1-coverage').textContent = pct(partial.coverage);
    el('p1-length').textContent = fmt(partial.length);
    el('p1-mse').textContent = fmt(partial.mse);
  }, result => {
    el('p1-coverage').textContent = pct(result.coverage);
    el('p1-length').textContent = fmt(result.length);
    el('p1-mse').textContent = fmt(result.mse);
    const mids = result.intervals.map((d, i) => ({ x: (d.lo + d.hi) / 2, y: i + 1 }));
    const lows = result.intervals.map(d => d.lo), highs = result.intervals.map(d => d.hi);
    destroyChart('p1');
    charts.p1 = new Chart(el('p1-chart'), {
      type: 'scatter',
      data: { datasets: [{ data: mids, pointRadius: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { min: Math.min(...lows, theta) * .94, max: Math.max(...highs, theta) * 1.06, title: { display: true, text: 'Valores del parámetro θ' }, grid: { color: palette.grid } },
          y: { min: 0, max: result.intervals.length + 1, ticks: { display: false }, title: { display: true, text: 'Réplicas' }, grid: { display: false } }
        }
      }
    });
    charts.p1.$intervals = result.intervals;
    charts.p1.$theta = theta;
    charts.p1.update();
  });
}

function exactBinomialCoverage(n, p, error) {
  if (p <= 0 || p >= 1) return 1;
  const lo = Math.max(0, Math.ceil(n * (p - error) - 1e-10));
  const hi = Math.min(n, Math.floor(n * (p + error) + 1e-10));
  if (lo > hi) return 0;
  const upper = jStat.binomial.cdf(hi, n, p);
  const lower = lo > 0 ? jStat.binomial.cdf(lo - 1, n, p) : 0;
  return Math.max(0, Math.min(1, upper - lower));
}

function runP2() {
  const n = num('p2-n'), error = num('p2-e'), confidence = num('p2-conf') / 100;
  const p = num('p2-p'), B = num('p2-b');
  const alpha = 1 - confidence;
  const z = jStat.normal.inv(1 - alpha / 2, 0, 1);
  const normalN = Math.ceil(z * z * .25 / (error * error));
  const hoeffdingN = Math.ceil(Math.log(2 / alpha) / (2 * error * error));
  el('p2-normal-n').textContent = normalN;
  el('p2-hoeffding-n').textContent = hoeffdingN;
  const points = [];
  let worst = { p: 0, c: 1 };
  for (let i = 0; i <= 200; i++) {
    const prob = i / 200;
    const c = exactBinomialCoverage(n, prob, error);
    points.push({ x: prob, y: c * 100 });
    if (c < worst.c) worst = { p: prob, c };
  }
  el('p2-worst').textContent = `${pct(worst.c)} en θ≈${worst.p.toFixed(3)}`;
  destroyChart('p2');
  charts.p2 = new Chart(el('p2-chart'), {
    type: 'line',
    data: { datasets: [
      { label: 'Cobertura binomial exacta', data: points, parsing: false, borderColor: palette.accent, backgroundColor: 'rgba(101,242,194,.10)', pointRadius: 0, borderWidth: 2, tension: 0 },
      { label: 'Objetivo', data: [{ x: 0, y: confidence * 100 }, { x: 1, y: confidence * 100 }], parsing: false, borderColor: palette.warn, borderDash: [7, 6], pointRadius: 0, borderWidth: 2 }
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { type: 'linear', min: 0, max: 1, title: { display: true, text: 'Proporción verdadera θ' }, grid: { color: palette.grid } },
        y: { min: Math.max(0, (worst.c * 100) - 2), max: 100, title: { display: true, text: 'Cobertura (%)' }, grid: { color: palette.grid } }
      }
    }
  });
  runWorker(2, { n, prob: p, error, B, seed: 2026 }, partial => {
    el('p2-mc').textContent = pct(partial.coverage);
  }, result => { el('p2-mc').textContent = `${pct(result.coverage)} en θ=${p.toFixed(2)}`; });
}

function runP3() {
  let a = num('p3-a'), b = num('p3-b');
  if (b <= a) { b = a + .5; el('p3-b').value = b; el('p3-b-out').textContent = b.toFixed(1); }
  const dist = el('p3-dist').value, param = num('p3-param'), n = num('p3-n'), B = num('p3-brep');
  const confidence = .95, alpha = .05, z = jStat.normal.inv(.975, 0, 1);
  const shape = .3 + param * 8;
  runWorker(3, { a, b, dist, param, shape, n, B, alpha, z, seed: 2026 }, partial => {
    el('p3-cov-normal').textContent = pct(partial.covCon);
    el('p3-cov-hoeff').textContent = pct(partial.covHoeff);
  }, result => {
    el('p3-var').textContent = fmt(result.variance);
    el('p3-bound').textContent = fmt(result.bound);
    el('p3-cov-normal').textContent = pct(result.covCon);
    el('p3-cov-hoeff').textContent = pct(result.covHoeff);
    const curve = [];
    for (let i = 0; i <= 100; i++) {
      const pr = i / 100;
      curve.push({ x: pr, y: pr * (1 - pr) * (b - a) ** 2 });
    }
    const markerX = dist === 'twopoint' ? param : .5;
    destroyChart('p3');
    charts.p3 = new Chart(el('p3-chart'), {
      type: 'line',
      data: { datasets: [
        { label: 'Varianza: masa en a y b', data: curve, parsing: false, borderColor: palette.blue, pointRadius: 0, borderWidth: 2, tension: .15 },
        { label: 'Distribución seleccionada', data: [{ x: markerX, y: result.variance }], parsing: false, borderColor: palette.accent, backgroundColor: palette.accent, pointRadius: 7, pointHoverRadius: 9 },
        { label: 'Cota máxima', data: [{ x: 0, y: result.bound }, { x: 1, y: result.bound }], parsing: false, borderColor: palette.warn, borderDash: [7,6], pointRadius: 0, borderWidth: 2 }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'linear', min: 0, max: 1, title: { display: true, text: 'P(X=a)=p' }, grid: { color: palette.grid } },
          y: { beginAtZero: true, title: { display: true, text: 'Varianza' }, grid: { color: palette.grid } }
        }
      }
    });
  });
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function histogram(values, min, max, bins) {
  const counts = Array(bins).fill(0);
  const width = (max - min) / bins || 1;
  values.forEach(v => {
    if (v < min || v > max || !Number.isFinite(v)) return;
    const i = Math.min(bins - 1, Math.floor((v - min) / width));
    counts[i]++;
  });
  const total = values.length || 1;
  return counts.map((c, i) => ({ x: min + (i + .5) * width, y: c / total / width }));
}

function runP4() {
  const theta = num('p4-theta'), n = num('p4-n'), B = num('p4-b'), seed = num('p4-seed');
  runWorker(4, { theta, n, B, seed }, null, result => {
    const byBias = [...result.stats].sort((a,b) => Math.abs(a.bias) - Math.abs(b.bias))[0];
    const byVar = [...result.stats].sort((a,b) => a.variance - b.variance)[0];
    const byMse = [...result.stats].sort((a,b) => a.mse - b.mse)[0];
    el('p4-best-bias').textContent = byBias.name;
    el('p4-best-var').textContent = byVar.name;
    el('p4-best-mse').textContent = byMse.name;
    el('p4-table').innerHTML = result.stats.map(s => `<tr><td>${s.name}</td><td>${fmt(s.bias)}</td><td>${fmt(s.variance)}</td><td>${fmt(s.mse)}</td></tr>`).join('');
    const combined = result.samples.flat().filter(Number.isFinite).sort((a,b) => a-b);
    const min = quantile(combined, .01), max = quantile(combined, .99);
    const colors = [palette.warn, palette.blue, palette.accent];
    const datasets = result.samples.map((sample, i) => ({
      label: result.stats[i].name,
      data: histogram(sample, min, max, 38), parsing: false,
      borderColor: colors[i], backgroundColor: `${colors[i]}44`, borderWidth: 1.4,
      pointRadius: 0, fill: true, tension: .16
    }));
    destroyChart('p4');
    charts.p4 = new Chart(el('p4-chart'), {
      type: 'line', data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', min, max, title: { display: true, text: 'Valor del estimador' }, grid: { color: palette.grid } },
          y: { beginAtZero: true, title: { display: true, text: 'Densidad empírica' }, grid: { color: palette.grid } }
        }
      }
    });
    charts.p4.$verticalLines = [{ value: theta, label: 'θ verdadero', color: palette.danger, dash: [6,5] }];
    charts.p4.update();
  });
}

function runP5() {
  const theta = num('p5-theta'), n = num('p5-n'), confidence = num('p5-conf') / 100;
  const B = num('p5-b'), seed = num('p5-seed'), alpha = 1 - confidence;
  runWorker(5, { theta, n, B, seed, alpha }, partial => {
    el('p5-exact').textContent = pct(partial.exact);
    el('p5-percentile').textContent = pct(partial.percentile);
    el('p5-basic').textContent = pct(partial.basic);
    el('p5-pivotal').textContent = pct(partial.pivotal);
  }, result => {
    el('p5-exact').textContent = pct(result.exact);
    el('p5-percentile').textContent = pct(result.percentile);
    el('p5-basic').textContent = pct(result.basic);
    el('p5-pivotal').textContent = pct(result.pivotal);
    const sorted = [...result.bootValues].sort((a,b) => a-b);
    const min = Math.min(theta, result.mObs) * .92;
    const max = quantile(sorted, .99);
    const hist = histogram(result.bootValues, min, max, 38);
    destroyChart('p5');
    charts.p5 = new Chart(el('p5-chart'), {
      type: 'bar',
      data: { datasets: [{ label: 'Distribución bootstrap de M*', data: hist, parsing: false, backgroundColor: 'rgba(136,167,255,.42)', borderColor: palette.blue, borderWidth: 1, barPercentage: 1, categoryPercentage: 1 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true } },
        scales: {
          x: { type: 'linear', min, max, title: { display: true, text: 'Mínimo bootstrap M*' }, grid: { color: palette.grid } },
          y: { beginAtZero: true, title: { display: true, text: 'Densidad empírica' }, grid: { color: palette.grid } }
        }
      }
    });
    charts.p5.$verticalLines = [
      { value: theta, label: 'θ verdadero', color: palette.danger, dash: [6,5] },
      { value: result.mObs, label: 'M observado', color: palette.accent, offset: 17 }
    ];
    charts.p5.update();
  });
}

function setupBindings() {
  bindRange('p1-theta','p1-theta-out',v => Number(v).toFixed(1));
  bindRange('p1-n','p1-n-out');
  bindRange('p1-conf','p1-conf-out',v => `${v}%`);
  bindRange('p1-b','p1-b-out');
  bindRange('p2-n','p2-n-out');
  bindRange('p2-e','p2-e-out',v => Number(v).toFixed(3));
  bindRange('p2-conf','p2-conf-out',v => `${v}%`);
  bindRange('p2-p','p2-p-out',v => Number(v).toFixed(2));
  bindRange('p2-b','p2-b-out');
  bindRange('p3-a','p3-a-out',v => Number(v).toFixed(1));
  bindRange('p3-b','p3-b-out',v => Number(v).toFixed(1));
  bindRange('p3-param','p3-param-out',v => Number(v).toFixed(2));
  bindRange('p3-n','p3-n-out');
  bindRange('p3-brep','p3-brep-out');
  bindRange('p4-theta','p4-theta-out',v => Number(v).toFixed(1));
  bindRange('p4-n','p4-n-out');
  bindRange('p4-b','p4-b-out');
  bindRange('p5-theta','p5-theta-out',v => Number(v).toFixed(1));
  bindRange('p5-n','p5-n-out');
  bindRange('p5-conf','p5-conf-out',v => `${v}%`);
  bindRange('p5-b','p5-b-out');
  el('p3-dist').addEventListener('change', () => {
    const dist = el('p3-dist').value;
    el('p3-param-label').childNodes[0].textContent = dist === 'twopoint' ? 'Probabilidad en a' : dist === 'beta' ? 'Concentración Beta' : 'Parámetro visual';
  });
  el('run-p1').addEventListener('click', runP1);
  el('run-p2').addEventListener('click', runP2);
  el('run-p3').addEventListener('click', runP3);
  el('run-p4').addEventListener('click', runP4);
  el('run-p5').addEventListener('click', runP5);
}

window.addEventListener('DOMContentLoaded', () => {
  setupBindings();
  const starts = [runP1, runP2, runP3, runP4, runP5];
  starts.forEach((fn, i) => setTimeout(fn, 500 + i * 450));
});
