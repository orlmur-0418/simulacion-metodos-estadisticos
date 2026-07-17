from __future__ import annotations

import math
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from scipy.stats import binom, gamma, norm

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "latex" / "figures"
OUT.mkdir(parents=True, exist_ok=True)
RNG = np.random.default_rng(2026)


def save(fig: plt.Figure, name: str) -> None:
    fig.tight_layout()
    fig.savefig(OUT / name, dpi=180, bbox_inches="tight")
    plt.close(fig)


def figure_1() -> None:
    theta, n, alpha, reps = 2.0, 30, 0.05, 100
    qlo = gamma.ppf(alpha / 2, a=n, scale=1)
    qhi = gamma.ppf(1 - alpha / 2, a=n, scale=1)
    intervals = []
    for _ in range(reps):
        sample = RNG.exponential(scale=1 / theta, size=n)
        s = sample.sum()
        lo, hi = qlo / s, qhi / s
        intervals.append((lo, hi, lo <= theta <= hi))
    fig, ax = plt.subplots(figsize=(8.2, 5.2))
    for i, (lo, hi, hit) in enumerate(intervals, start=1):
        ax.plot([lo, hi], [i, i], linewidth=1.5, alpha=0.85)
        ax.plot((lo + hi) / 2, i, marker="o", markersize=2.8)
    ax.axvline(theta, linestyle="--", linewidth=2, label=r"$\theta$ verdadero")
    ax.set_xlabel(r"Intervalo para $\theta$")
    ax.set_ylabel("Réplica")
    ax.set_title("Cien intervalos de confianza exactos para la tasa exponencial")
    ax.legend(frameon=False)
    save(fig, "problema1_intervalos.png")


def exact_coverage(n: int, p: np.ndarray, error: float) -> np.ndarray:
    lo = np.ceil(n * (p - error) - 1e-12).astype(int)
    hi = np.floor(n * (p + error) + 1e-12).astype(int)
    lo = np.clip(lo, 0, n)
    hi = np.clip(hi, 0, n)
    return binom.cdf(hi, n, p) - binom.cdf(lo - 1, n, p)


def figure_2() -> None:
    ps = np.linspace(0.001, 0.999, 1200)
    fig, ax = plt.subplots(figsize=(8.2, 4.8))
    for n in (752, 767):
        ax.plot(ps, exact_coverage(n, ps, 0.03), label=fr"$n={n}$")
    ax.axhline(0.90, linestyle="--", linewidth=1.8, label="Objetivo 90%")
    ax.set_ylim(0.885, 0.925)
    ax.set_xlabel(r"Proporción verdadera $\theta$")
    ax.set_ylabel("Cobertura exacta")
    ax.set_title("La discreción binomial produce oscilaciones de cobertura")
    ax.legend(frameon=False)
    save(fig, "problema2_cobertura.png")


def figure_3() -> None:
    p = np.linspace(0, 1, 400)
    variance = p * (1 - p)
    fig, ax = plt.subplots(figsize=(8.2, 4.8))
    ax.plot(p, variance, linewidth=2.2, label=r"$p(1-p)(b-a)^2$ con $a=0,b=1$")
    ax.axhline(0.25, linestyle="--", linewidth=1.8, label=r"Cota $(b-a)^2/4$")
    ax.scatter([0.5], [0.25], s=55, zorder=4)
    ax.set_xlabel(r"$p=P(X=a)$")
    ax.set_ylabel(r"$\mathrm{Var}(X)$")
    ax.set_title("La varianza máxima se alcanza con masa igual en los extremos")
    ax.legend(frameon=False)
    save(fig, "problema3_varianza.png")


def estimators(theta: float, n: int, reps: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    u = RNG.random((reps, n))
    x = u ** (1 / (theta + 1))
    xbar = x.mean(axis=1)
    logs = np.log(x).sum(axis=1)
    mm = (2 * xbar - 1) / (1 - xbar)
    mle = -n / logs - 1
    corrected = -(n - 1) / logs - 1
    return mm, mle, corrected


def figure_4() -> None:
    theta = 2.0
    ns = np.array([5, 10, 20, 40, 80, 150])
    reps = 25000
    labels = ["Momentos", "MLE", "MLE corregido"]
    mse = np.zeros((3, len(ns)))
    bias = np.zeros_like(mse)
    for j, n in enumerate(ns):
        vals = estimators(theta, int(n), reps)
        for i, v in enumerate(vals):
            bias[i, j] = np.mean(v - theta)
            mse[i, j] = np.mean((v - theta) ** 2)
    fig, ax = plt.subplots(figsize=(8.2, 5.0))
    for i, label in enumerate(labels):
        ax.plot(ns, mse[i], marker="o", label=label)
    ax.set_xlabel(r"Tamaño de muestra $n$")
    ax.set_ylabel("Error cuadrático medio")
    ax.set_title(r"El MLE domina al método de momentos al crecer $n$")
    ax.set_yscale("log")
    ax.legend(frameon=False)
    save(fig, "problema4_estimadores.png")


def figure_5() -> None:
    theta, n, alpha, reps = 2.0, 20, 0.05, 40000
    umax = RNG.random(reps) ** (1 / n)
    m = theta / umax
    exact_lo = m * (alpha / 2) ** (1 / n)
    exact_hi = m * (1 - alpha / 2) ** (1 / n)
    rlo = (1 - alpha / 2) ** (-1 / n)
    rhi = (alpha / 2) ** (-1 / n)
    per_lo, per_hi = m * rlo, m * rhi
    bas_lo, bas_hi = 2 * m - per_hi, 2 * m - per_lo
    piv_lo, piv_hi = m / rhi, m / rlo
    cover = [
        np.mean((exact_lo <= theta) & (theta <= exact_hi)),
        np.mean((per_lo <= theta) & (theta <= per_hi)),
        np.mean((bas_lo <= theta) & (theta <= bas_hi)),
        np.mean((piv_lo <= theta) & (theta <= piv_hi)),
    ]
    fig, ax = plt.subplots(figsize=(8.2, 4.8))
    labels = ["Exacto", "Percentil", "Básico", "Pivotal"]
    bars = ax.bar(labels, np.array(cover) * 100)
    ax.axhline(95, linestyle="--", linewidth=1.8, label="Cobertura nominal")
    ax.set_ylim(0, 102)
    ax.set_ylabel("Cobertura empírica (%)")
    ax.set_title("El bootstrap percentil falla cuando el soporte depende de θ")
    ax.bar_label(bars, fmt="%.1f%%", padding=3)
    ax.legend(frameon=False)
    save(fig, "problema5_bootstrap.png")


if __name__ == "__main__":
    plt.rcParams.update({
        "font.size": 10.5,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
    })
    figure_1()
    figure_2()
    figure_3()
    figure_4()
    figure_5()
    print(f"Figuras guardadas en {OUT}")
