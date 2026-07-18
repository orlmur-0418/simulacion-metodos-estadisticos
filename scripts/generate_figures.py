from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "codex-matplotlib-cache"))

try:
    import matplotlib
    import numpy as np
    from scipy.stats import binom, gamma, norm
except ImportError as exc:  # Mensaje más útil que un traceback de importación.
    missing = getattr(exc, "name", "una dependencia")
    raise SystemExit(
        f"Falta {missing}. Instale las dependencias con: "
        "python -m pip install -r requirements.txt"
    ) from exc

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


SEED = 1966
ROOT = Path(__file__).resolve().parents[1]
FIGURE_NAMES = (
    "problema1_intervalos.png",
    "problema2_cobertura.png",
    "problema3_varianza.png",
    "problema3_cobertura_intervalos.png",
    "problema4_estimadores.png",
    "problema5_bootstrap.png",
)


def save(fig: plt.Figure, output_dir: Path, name: str) -> None:
    fig.tight_layout()
    fig.savefig(output_dir / name, dpi=180, bbox_inches="tight")
    plt.close(fig)


def figure_problem_1(output_dir: Path) -> None:
    rng = np.random.default_rng(SEED)
    theta, n, alpha, visible = 2.0, 30, 0.05, 100
    q_low = gamma.ppf(alpha / 2, a=n, scale=1)
    q_high = gamma.ppf(1 - alpha / 2, a=n, scale=1)
    samples = rng.exponential(scale=1 / theta, size=(visible, n))
    sums = samples.sum(axis=1)
    lows, highs = q_low / sums, q_high / sums
    hits = (lows <= theta) & (theta <= highs)

    fig, ax = plt.subplots(figsize=(8.8, 5.4))
    colors = np.where(hits, "#2a9d8f", "#d1495b")
    for index, (low, high, color) in enumerate(zip(lows, highs, colors), start=1):
        ax.plot([low, high], [index, index], color=color, linewidth=1.5)
        ax.plot((low + high) / 2, index, "o", color=color, markersize=2.5)
    ax.axvline(theta, color="#264653", linestyle="--", linewidth=2, label=r"$\theta=2$")
    ax.set_xlabel(r"Intervalo exacto para $\theta$")
    ax.set_ylabel("Réplica visible")
    ax.set_title("Primeros cien intervalos para la tasa exponencial")
    ax.legend(frameon=False)
    save(fig, output_dir, FIGURE_NAMES[0])


def exact_binomial_coverage(n: int, probabilities: np.ndarray, error: float) -> np.ndarray:
    lows = np.ceil(n * (probabilities - error) - 1e-12).astype(int)
    highs = np.floor(n * (probabilities + error) + 1e-12).astype(int)
    lows = np.clip(lows, 0, n)
    highs = np.clip(highs, 0, n)
    return binom.cdf(highs, n, probabilities) - binom.cdf(lows - 1, n, probabilities)


def figure_problem_2(output_dir: Path) -> None:
    probabilities = np.linspace(0.001, 0.999, 1200)
    fig, ax = plt.subplots(figsize=(8.8, 5.0))
    for n, color in ((752, "#2a6fbb"), (767, "#2a9d8f")):
        ax.plot(
            probabilities,
            exact_binomial_coverage(n, probabilities, 0.03) * 100,
            color=color,
            linewidth=1.8,
            label=fr"$n={n}$",
        )
    ax.axhline(90, color="#c0392b", linestyle="--", linewidth=1.8, label="Objetivo 90 %")
    ax.set_ylim(88.5, 92.5)
    ax.set_xlabel(r"Proporción verdadera $\theta$")
    ax.set_ylabel("Probabilidad binomial exacta (%)")
    ax.set_title("La discreción binomial produce oscilaciones de cobertura")
    ax.legend(frameon=False)
    save(fig, output_dir, FIGURE_NAMES[1])


def figure_problem_3_variance(output_dir: Path) -> None:
    probabilities = np.linspace(0, 1, 400)
    variance = probabilities * (1 - probabilities)
    fig, ax = plt.subplots(figsize=(8.8, 5.0))
    ax.plot(probabilities, variance, color="#2a6fbb", linewidth=2.2, label=r"$p(1-p)(b-a)^2$")
    ax.axhline(0.25, color="#d97706", linestyle="--", linewidth=1.8, label=r"Cota $(b-a)^2/4$")
    ax.scatter([0.5], [0.25], color="#2a9d8f", s=55, zorder=4, label="Máximo en p=0.5")
    ax.set_xlabel(r"$p=P(X=a)$")
    ax.set_ylabel(r"$\operatorname{Var}(X)$")
    ax.set_title("La distribución de dos puntos alcanza la varianza máxima")
    ax.legend(frameon=False)
    save(fig, output_dir, FIGURE_NAMES[2])


def simulated_interval_coverages() -> np.ndarray:
    rng = np.random.default_rng(SEED)
    n, repetitions, alpha = 100, 50_000, 0.05
    half_tcl = norm.ppf(1 - alpha / 2) / (2 * np.sqrt(n))
    half_hoeffding = np.sqrt(np.log(2 / alpha) / (2 * n))
    coverages = []
    for distribution in ("two_points", "uniform", "beta"):
        if distribution == "two_points":
            samples = rng.integers(0, 2, size=(repetitions, n))
        elif distribution == "uniform":
            samples = rng.random((repetitions, n))
        else:
            samples = rng.beta(4, 4, size=(repetitions, n))
        means = samples.mean(axis=1)
        coverages.append((
            np.mean(np.abs(means - 0.5) <= half_tcl),
            np.mean(np.abs(means - 0.5) <= half_hoeffding),
        ))
    return np.asarray(coverages)


def figure_problem_3_intervals(output_dir: Path) -> None:
    simulated = simulated_interval_coverages()
    definitive = np.array([[94.23, 99.33], [99.94, 100.00], [100.00, 100.00]])
    if np.max(np.abs(simulated * 100 - definitive)) > 0.75:
        raise RuntimeError("La simulación del problema 3 se apartó de los resultados académicos esperados.")

    labels = ["Dos puntos", "Uniforme", "Beta(4,4)"]
    positions = np.arange(len(labels))
    width = 0.34
    fig, ax = plt.subplots(figsize=(9.2, 5.3))
    bars_tcl = ax.bar(positions - width / 2, definitive[:, 0], width, color="#2a659d", label="Conservador (TCL)")
    bars_hoeffding = ax.bar(positions + width / 2, definitive[:, 1], width, color="#dc7b00", label="Hoeffding")
    ax.axhline(95, color="#c0392b", linestyle="--", linewidth=1.8, label="Cobertura nominal (95 %)")
    ax.bar_label(bars_tcl, fmt="%.2f %%", padding=3)
    ax.bar_label(bars_hoeffding, fmt="%.2f %%", padding=3)
    ax.set_xticks(positions, labels)
    ax.set_ylim(90, 101.2)
    ax.set_ylabel("Porcentaje de inclusión de la media (%)")
    ax.set_title("Cobertura y concentración para distribuciones acotadas\n"
                 "n=100, B=50 000; longitudes: TCL=0.1960 y Hoeffding=0.2716")
    ax.legend(frameon=False, loc="lower center", bbox_to_anchor=(0.5, -0.27), ncol=3)
    save(fig, output_dir, FIGURE_NAMES[3])


def estimators(theta: float, n: int, repetitions: int, rng: np.random.Generator) -> tuple[np.ndarray, ...]:
    uniforms = np.maximum(rng.random((repetitions, n)), np.finfo(float).tiny)
    samples = uniforms ** (1 / (theta + 1))
    means = samples.mean(axis=1)
    log_sums = np.log(samples).sum(axis=1)
    moments = (2 * means - 1) / (1 - means)
    emv = -n / log_sums - 1
    corrected = -(n - 1) / log_sums - 1
    return moments, emv, corrected


def figure_problem_4(output_dir: Path) -> None:
    rng = np.random.default_rng(SEED)
    theta, repetitions = 2.0, 25_000
    sizes = np.array([5, 10, 20, 40, 80, 150])
    mse = np.zeros((3, len(sizes)))
    for column, n in enumerate(sizes):
        for row, values in enumerate(estimators(theta, int(n), repetitions, rng)):
            mse[row, column] = np.mean((values - theta) ** 2)

    styles = (("Momentos", "#2a659d", "o", "-"), ("EMV", "#c0392b", "s", "--"), ("EMV corregido", "#2f8734", "^", "-."))
    fig, ax = plt.subplots(figsize=(9.2, 5.4))
    for row, (label, color, marker, linestyle) in enumerate(styles):
        ax.plot(sizes, mse[row], color=color, marker=marker, linestyle=linestyle, linewidth=2, label=label)
    ax.set_yscale("log")
    ax.set_xticks(sizes)
    ax.set_xlabel(r"Tamaño de muestra $n$")
    ax.set_ylabel("Error cuadrático medio")
    ax.set_title("ECM de momentos, EMV y EMV corregido")
    ax.legend(frameon=False)
    save(fig, output_dir, FIGURE_NAMES[4])


def figure_problem_5(output_dir: Path) -> None:
    rng = np.random.default_rng(SEED)
    theta, n, alpha, repetitions = 2.0, 20, 0.05, 40_000
    maxima = rng.random(repetitions) ** (1 / n)
    minimum = theta / maxima
    ratio_low = (1 - alpha / 2) ** (-1 / n)
    ratio_high = (alpha / 2) ** (-1 / n)
    intervals = (
        (minimum * (alpha / 2) ** (1 / n), minimum * (1 - alpha / 2) ** (1 / n)),
        (minimum * ratio_low, minimum * ratio_high),
        (2 * minimum - minimum * ratio_high, 2 * minimum - minimum * ratio_low),
        (minimum / ratio_high, minimum / ratio_low),
    )
    simulated = np.array([np.mean((low <= theta) & (theta <= high)) for low, high in intervals]) * 100
    definitive = np.array([94.92, 0.00, 96.49, 94.92])
    if np.max(np.abs(simulated - definitive)) > 0.75:
        raise RuntimeError("La simulación del problema 5 se apartó de los resultados académicos esperados.")

    labels = ["Exacto", "Percentil", "Básico", "Pivotal"]
    colors = ["#2a659d", "#d1495b", "#dc7b00", "#2f8734"]
    fig, ax = plt.subplots(figsize=(9.2, 5.3))
    bars = ax.bar(labels, definitive, color=colors)
    ax.axhline(95, color="#6b4fa1", linestyle="--", linewidth=1.8, label="Cobertura nominal (95 %)")
    for bar, value in zip(bars, definitive):
        if value > 10:
            ax.text(bar.get_x() + bar.get_width() / 2, value - 4, f"{value:.2f} %", ha="center", va="center", color="white", fontweight="bold")
        else:
            ax.text(bar.get_x() + bar.get_width() / 2, value + 1.5, f"{value:.2f} %", ha="center", va="bottom")
    ax.set_ylim(0, 103)
    ax.set_ylabel("Porcentaje de inclusión de θ (%)")
    ax.set_title("Comparación del bootstrap paramétrico con el intervalo exacto")
    ax.legend(frameon=False, loc="lower center", bbox_to_anchor=(0.5, -0.28))
    save(fig, output_dir, FIGURE_NAMES[5])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Genera las seis figuras definitivas de la actividad.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "figures_clear",
        help="Carpeta de salida; por defecto, figures_clear en la raíz del repositorio.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({
        "font.size": 10.5,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "axes.grid": True,
        "grid.alpha": 0.25,
    })
    figure_problem_1(output_dir)
    figure_problem_2(output_dir)
    figure_problem_3_variance(output_dir)
    figure_problem_3_intervals(output_dir)
    figure_problem_4(output_dir)
    figure_problem_5(output_dir)
    print(f"Se generaron {len(FIGURE_NAMES)} figuras en {output_dir}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # El workflow necesita un mensaje breve y claro.
        print(f"Error al generar las figuras: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
