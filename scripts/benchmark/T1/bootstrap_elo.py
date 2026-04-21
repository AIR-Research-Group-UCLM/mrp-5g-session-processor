#!/usr/bin/env python3
"""
T1 - Elo Stability Intervals via Order Permutation
==================================================

Replays the human A/B comparison log N times with the order of duels
shuffled. For each permutation it recomputes the final Elo per model,
then reports the mean and the 2.5 / 97.5 percentiles of the resulting
distribution.

Nomenclature
------------
The output is a **95% permutation stability band**, NOT a statistical
confidence interval in the strict sense. The distinction matters and is
preserved in the labels of the output table and the JSON summary.

  - A proper bootstrap confidence interval resamples the observations
    WITH replacement, capturing sampling uncertainty ("what if we had
    collected a different set of duels?").
  - This method shuffles the existing observations WITHOUT replacement,
    capturing path-dependence uncertainty ("how much of each rating is
    an artifact of the order in which duels happened to be judged?").

Online Elo applies K=32 updates sequentially, so the final rating
depends on the order of games. Shuffling the order N=1000 times and
taking percentiles quantifies that order-sensitivity. This is the exact
method LMSYS Chatbot Arena used in its first leaderboard (Dec 2023)
before switching to an order-invariant Bradley-Terry MLE plus a
true with-replacement bootstrap.

Use case
--------
Task T1 asks whether the "top-three tie" in the Elo ranking is real or
an artifact of evaluation order. If the stability bands of the top
models overlap, the ordering between them is not distinguishable from
duel-order noise, which confirms the tie. This is a path-dependence
diagnostic, and for that purpose the permutation approach is the right
tool.

Usage
-----
    python bootstrap_elo.py [--iterations 1000] [--seed 42] \
                            [--lang EN|ES|all] [--quantile 0.95] \
                            [--output-json T1_summary.json]
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path

# Reuse the Elo replay logic from the sibling compare.py so this script
# stays in sync with whatever the main comparison tool uses.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from compare import (  # noqa: E402
    load_existing_comparisons,
    load_results,
    rebuild_elo,
)

try:
    from rich.console import Console
    from rich.table import Table
except ImportError:
    print("ERROR: 'rich' package required. Install with: pip install rich")
    sys.exit(1)

console = Console(record=True, width=140)


# --- Statistics helpers ---


def quantile(sorted_samples: list[float], q: float) -> float:
    """Linear-interpolated quantile over an already-sorted list."""
    if not sorted_samples:
        return 0.0
    if len(sorted_samples) == 1:
        return sorted_samples[0]
    pos = q * (len(sorted_samples) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(sorted_samples) - 1)
    frac = pos - lo
    return sorted_samples[lo] * (1 - frac) + sorted_samples[hi] * frac


def permute_elo(
    comparisons: list[dict], iterations: int, rng: random.Random
) -> dict[str, list[float]]:
    """Replay `comparisons` `iterations` times with shuffled duel order.

    Returns {model: [final_rating_per_iteration, ...]}.
    """
    samples: dict[str, list[float]] = defaultdict(list)

    # rebuild_elo already ignores skipped duels; pre-filtering avoids
    # shuffling rows that will be discarded anyway.
    usable = [c for c in comparisons if c.get("choice") not in ("S", "skip")]

    if not usable:
        return samples

    working = list(usable)
    for _ in range(iterations):
        rng.shuffle(working)
        elo_state = rebuild_elo(working)
        for model, state in elo_state.items():
            samples[model].append(state.rating)

    return samples


def summarize(
    samples: dict[str, list[float]], coverage: float
) -> dict[str, dict[str, float]]:
    """Return {model: {mean, stdev, lower, upper}} for the requested band."""
    lo_q = (1 - coverage) / 2
    hi_q = (1 + coverage) / 2
    out: dict[str, dict[str, float]] = {}
    for model, vals in samples.items():
        sorted_vals = sorted(vals)
        out[model] = {
            "mean": statistics.mean(sorted_vals),
            "stdev": statistics.stdev(sorted_vals) if len(sorted_vals) > 1 else 0.0,
            "lower": quantile(sorted_vals, lo_q),
            "upper": quantile(sorted_vals, hi_q),
        }
    return out


def intervals_overlap(a: dict[str, float], b: dict[str, float]) -> bool:
    return a["lower"] <= b["upper"] and b["lower"] <= a["upper"]


def find_overlaps(
    summary: dict[str, dict[str, float]],
) -> list[dict[str, float | str]]:
    """Return every pair of models whose bands intersect.

    Output is sorted by mean gap ascending (most "tied" pairs first).
    """
    ranked = sorted(summary.items(), key=lambda kv: kv[1]["mean"], reverse=True)
    overlaps: list[dict[str, float | str]] = []
    for i in range(len(ranked)):
        for j in range(i + 1, len(ranked)):
            m_a, s_a = ranked[i]
            m_b, s_b = ranked[j]
            if not intervals_overlap(s_a, s_b):
                continue
            ov_lo = max(s_a["lower"], s_b["lower"])
            ov_hi = min(s_a["upper"], s_b["upper"])
            overlaps.append(
                {
                    "model_a": m_a,
                    "model_b": m_b,
                    "mean_a": s_a["mean"],
                    "mean_b": s_b["mean"],
                    "band_a_lo": s_a["lower"],
                    "band_a_hi": s_a["upper"],
                    "band_b_lo": s_b["lower"],
                    "band_b_hi": s_b["upper"],
                    "overlap_lo": ov_lo,
                    "overlap_hi": ov_hi,
                    "overlap_width": ov_hi - ov_lo,
                    "mean_gap": abs(s_a["mean"] - s_b["mean"]),
                }
            )
    overlaps.sort(key=lambda o: o["mean_gap"])
    return overlaps


# --- Auxiliary stats (W/L/T and performance) ---


def win_loss_tie(comparisons: list[dict]) -> dict[str, dict[str, int]]:
    """Count W/L/T per model from the actual judgments, not the permutations."""
    totals: dict[str, dict[str, int]] = defaultdict(
        lambda: {"w": 0, "l": 0, "t": 0}
    )
    for comp in comparisons:
        choice = comp.get("choice", "skip")
        if choice in ("S", "skip"):
            continue
        a, b = comp["model_a"], comp["model_b"]
        if choice == "A":
            totals[a]["w"] += 1
            totals[b]["l"] += 1
        elif choice == "B":
            totals[b]["w"] += 1
            totals[a]["l"] += 1
        elif choice == "T":
            totals[a]["t"] += 1
            totals[b]["t"] += 1
    return totals


def performance(results) -> dict[str, dict[str, float]]:
    """Average wall-clock time and tokens/s per model across all runs."""
    buckets: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: {"time": [], "toks": []}
    )
    for (model, _lang), runs in results.items():
        for r in runs:
            buckets[model]["time"].append(r.wall_clock_s)
            buckets[model]["toks"].append(r.tokens_per_second)

    out: dict[str, dict[str, float]] = {}
    for model, b in buckets.items():
        out[model] = {
            "avg_time_s": sum(b["time"]) / len(b["time"]) if b["time"] else 0.0,
            "avg_tokens_per_sec": sum(b["toks"]) / len(b["toks"]) if b["toks"] else 0.0,
        }
    return out


# --- Output ---


def print_preamble(
    iterations: int,
    coverage: float,
    seed: int | None,
    lang_filter: str,
    n_total: int,
    n_usable: int,
    jsonl_path: Path,
) -> None:
    """Print a short, self-contained explanation of the method and parameters.

    Emitted once at the top of every run so the captured log is readable on its
    own without referencing the source code.
    """
    pct = int(round(coverage * 100))
    lo_pct = (1 - coverage) / 2 * 100
    hi_pct = (1 + coverage) / 2 * 100

    console.rule("[bold]T1 - Elo stability under duel-order permutation[/bold]")
    console.print(
        "\n[bold]What this measures[/bold]\n"
        "  Online Elo (K=32, sequential updates) is path-dependent: the final\n"
        "  rating of each model depends on the order in which duels were judged.\n"
        f"  Shuffling the recorded duels {iterations} times and recomputing the\n"
        "  final rating for each permutation yields a distribution of plausible\n"
        f"  final Elos per model. The reported band covers the central {pct}%\n"
        f"  of that distribution (percentiles {lo_pct:.1f} to {hi_pct:.1f}).\n"
        "  In plain terms: the band is the Elo range each model lands in across\n"
        "  those permutations - narrow = stable to reordering, wide = order-sensitive.\n"
    )
    console.print(
        "[bold]What the band is NOT[/bold]\n"
        "  It is not a statistical confidence interval for 'true skill' or for\n"
        "  sampling uncertainty. The set of duels is held fixed; only their\n"
        "  order is resampled without replacement. A proper sampling CI would\n"
        "  resample duels with replacement and ideally use an order-invariant\n"
        "  estimator (e.g. Bradley-Terry MLE, as in Chatbot Arena since late\n"
        "  2023). See the module docstring for citations.\n"
    )
    console.print(
        "[bold]How to read the output[/bold]\n"
        "  - Main table: models sorted by mean permuted Elo, descending.\n"
        "    W/L/T come from the raw judgments, not the permutations.\n"
        "    Avg Time and Avg tok/s come from the generation benchmark logs.\n"
        "  - Pairwise overlaps table: every pair whose bands intersect. Each row\n"
        "    is a pair whose ranking is not distinguishable from ordering noise.\n"
        "    Sorted by mean gap ascending (most tied pairs first).\n"
    )
    console.print(
        "[bold]Run parameters[/bold]\n"
        f"  method          : permutation stability band (shuffle without replacement)\n"
        f"  iterations      : {iterations}\n"
        f"  coverage        : {pct}% ({lo_pct:.1f}th - {hi_pct:.1f}th percentile)\n"
        f"  seed            : {seed if seed is not None else 'random (system time)'}\n"
        f"  language filter : {lang_filter}\n"
        f"  comparisons src : {jsonl_path}\n"
        f"  comparisons (N) : {n_total} total, {n_usable} usable, "
        f"{n_total - n_usable} skipped\n"
    )
    console.rule()


def render_table(
    summary: dict[str, dict[str, float]],
    wlt: dict[str, dict[str, int]],
    perf: dict[str, dict[str, float]],
    coverage: float,
    iterations: int,
) -> None:
    ranked = sorted(summary.items(), key=lambda kv: kv[1]["mean"], reverse=True)
    pct = int(round(coverage * 100))
    band_label = f"{pct}% permutation band"

    table = Table(
        title=(
            f"T1 - Elo stability under order permutation "
            f"(N={iterations}, {band_label})"
        ),
        show_lines=True,
    )
    table.add_column("#", style="bold", width=3, justify="center")
    table.add_column("Model", style="cyan")
    table.add_column("Elo (mean)", style="bold green", justify="right")
    table.add_column(band_label, justify="center")
    table.add_column("Width", justify="right")
    table.add_column("W", justify="right")
    table.add_column("L", justify="right")
    table.add_column("T", justify="right")
    table.add_column("Avg Time (s)", justify="right")
    table.add_column("Avg tok/s", justify="right")

    for rank, (model, stats) in enumerate(ranked, 1):
        counts = wlt.get(model, {"w": 0, "l": 0, "t": 0})
        pstats = perf.get(model, {"avg_time_s": 0.0, "avg_tokens_per_sec": 0.0})

        table.add_row(
            str(rank),
            model,
            f"{stats['mean']:.0f}",
            f"[{stats['lower']:.0f}-{stats['upper']:.0f}]",
            f"{stats['upper'] - stats['lower']:.0f}",
            str(counts["w"]),
            str(counts["l"]),
            str(counts["t"]),
            f"{pstats['avg_time_s']:.1f}",
            f"{pstats['avg_tokens_per_sec']:.1f}",
        )

    console.print(table)


def render_overlaps(
    overlaps: list[dict[str, float | str]],
    n_models: int,
) -> None:
    """Render the pairwise-overlap table: every pair whose bands intersect."""
    total_pairs = n_models * (n_models - 1) // 2

    console.print(
        f"\n[bold]Pairwise band overlaps[/bold]  "
        f"[dim]({len(overlaps)} of {total_pairs} pairs overlap)[/dim]"
    )
    console.print(
        "[dim]An overlap means there exist duel orderings under which the two\n"
        "models swap ranks. The pair's Elo gap is not distinguishable from\n"
        "ordering noise. Sorted by mean gap ascending (most tied first).[/dim]\n"
    )

    if not overlaps:
        console.print(
            "  [green]No band overlaps - every pair is distinguishable under "
            "ordering noise.[/green]"
        )
        return

    table = Table(show_lines=False)
    table.add_column("Model A", style="cyan")
    table.add_column("Band A", justify="center")
    table.add_column("Model B", style="cyan")
    table.add_column("Band B", justify="center")
    table.add_column("Overlap", justify="center", style="yellow")
    table.add_column("Ov. width", justify="right")
    table.add_column("Mean gap", justify="right")

    for ov in overlaps:
        table.add_row(
            str(ov["model_a"]),
            f"[{ov['band_a_lo']:.0f}-{ov['band_a_hi']:.0f}]",
            str(ov["model_b"]),
            f"[{ov['band_b_lo']:.0f}-{ov['band_b_hi']:.0f}]",
            f"[{ov['overlap_lo']:.0f}-{ov['overlap_hi']:.0f}]",
            f"{ov['overlap_width']:.0f}",
            f"{ov['mean_gap']:.0f}",
        )

    console.print(table)
    console.print(
        "\n[dim]Reminder: this is a path-dependence stability band, not a sampling\n"
        "   confidence interval. A true sampling CI requires with-replacement\n"
        "   resampling over duels (ideally with an order-invariant estimator\n"
        "   such as Bradley-Terry MLE).[/dim]"
    )


def write_json(
    path: Path,
    summary: dict[str, dict[str, float]],
    wlt: dict[str, dict[str, int]],
    perf: dict[str, dict[str, float]],
    overlaps: list[dict[str, float | str]],
    coverage: float,
    iterations: int,
    seed: int | None,
    n_comparisons: int,
    lang_filter: str,
) -> None:
    payload = {
        "method": "permutation_stability_band",
        "description": (
            "Shuffle duel order without replacement, recompute final Elo per "
            "iteration, report mean and percentiles across iterations. This is "
            "a path-dependence diagnostic for online Elo, not a sampling "
            "confidence interval."
        ),
        "iterations": iterations,
        "coverage": coverage,
        "seed": seed,
        "language_filter": lang_filter,
        "n_comparisons_used": n_comparisons,
        "models": {
            model: {
                "elo_mean": stats["mean"],
                "elo_stdev": stats["stdev"],
                "band_lower": stats["lower"],
                "band_upper": stats["upper"],
                "band_width": stats["upper"] - stats["lower"],
                "wins": wlt.get(model, {}).get("w", 0),
                "losses": wlt.get(model, {}).get("l", 0),
                "ties": wlt.get(model, {}).get("t", 0),
                "avg_time_s": perf.get(model, {}).get("avg_time_s", 0.0),
                "avg_tokens_per_sec": perf.get(model, {}).get(
                    "avg_tokens_per_sec", 0.0
                ),
            }
            for model, stats in summary.items()
        },
        "pairwise_overlaps": overlaps,
    }
    path.write_text(json.dumps(payload, indent=2))


# --- Main ---


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "T1 - Elo stability intervals via order permutation. "
            "Path-dependence diagnostic for online Elo ratings."
        )
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=1000,
        help="Number of permutations (default: 1000)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="RNG seed for reproducibility (default: system time)",
    )
    parser.add_argument(
        "--lang",
        default="all",
        help="Filter duels by language: EN, ES, or all (default: all)",
    )
    parser.add_argument(
        "--quantile",
        type=float,
        default=0.95,
        help="Band coverage in (0, 1), e.g. 0.95 -> 2.5/97.5 pct (default: 0.95)",
    )
    parser.add_argument(
        "--results-dir",
        default="../results",
        help="Benchmark results directory (default: ../results relative to script)",
    )
    parser.add_argument(
        "--comparisons",
        default="../comparisons.jsonl",
        help="Path to comparisons.jsonl (default: ../comparisons.jsonl)",
    )
    parser.add_argument(
        "--output-json",
        default=None,
        help="Optional path to write machine-readable summary JSON",
    )
    parser.add_argument(
        "--log-file",
        default="T1.log",
        help="Path to write the plain-text run log (default: T1.log next to script)",
    )
    parser.add_argument(
        "--no-log",
        action="store_true",
        help="Disable writing the T1.log file",
    )
    args = parser.parse_args()

    if not (0.0 < args.quantile < 1.0):
        console.print("[red]--quantile must be in (0, 1).[/red]")
        sys.exit(1)
    if args.iterations < 1:
        console.print("[red]--iterations must be >= 1.[/red]")
        sys.exit(1)

    script_dir = Path(__file__).resolve().parent

    results_dir = Path(args.results_dir)
    if not results_dir.is_absolute():
        results_dir = (script_dir / results_dir).resolve()

    jsonl_path = Path(args.comparisons)
    if not jsonl_path.is_absolute():
        jsonl_path = (script_dir / jsonl_path).resolve()

    comparisons = load_existing_comparisons(jsonl_path)
    if not comparisons:
        console.print(f"[red]No comparisons found at {jsonl_path}.[/red]")
        sys.exit(1)

    if args.lang != "all":
        want = args.lang.upper()
        comparisons = [
            c for c in comparisons if c.get("language", "").upper() == want
        ]
        if not comparisons:
            console.print(
                f"[red]No comparisons match language filter '{args.lang}'.[/red]"
            )
            sys.exit(1)

    usable = [c for c in comparisons if c.get("choice") not in ("S", "skip")]

    print_preamble(
        iterations=args.iterations,
        coverage=args.quantile,
        seed=args.seed,
        lang_filter=args.lang,
        n_total=len(comparisons),
        n_usable=len(usable),
        jsonl_path=jsonl_path,
    )

    results = load_results(results_dir, args.lang)

    rng = random.Random(args.seed)

    console.print(f"\nRunning {args.iterations} permutations... ", end="")
    samples = permute_elo(comparisons, args.iterations, rng)
    console.print("[green]done[/green]")

    if not samples:
        console.print("[red]No usable comparisons to replay.[/red]")
        sys.exit(1)

    summary = summarize(samples, args.quantile)
    wlt = win_loss_tie(comparisons)
    perf = performance(results)

    console.print()
    render_table(summary, wlt, perf, args.quantile, args.iterations)

    overlaps = find_overlaps(summary)
    render_overlaps(overlaps, n_models=len(summary))

    if args.output_json:
        out_path = Path(args.output_json)
        if not out_path.is_absolute():
            out_path = (script_dir / out_path).resolve()
        write_json(
            out_path,
            summary,
            wlt,
            perf,
            overlaps,
            args.quantile,
            args.iterations,
            args.seed,
            len(usable),
            args.lang,
        )
        console.print(f"\n[dim]Summary written to {out_path}[/dim]")

    if not args.no_log:
        log_path = Path(args.log_file)
        if not log_path.is_absolute():
            log_path = (script_dir / log_path).resolve()
        # save_text strips ANSI codes and writes plain UTF-8.
        console.save_text(str(log_path), clear=False)
        console.print(f"[dim]Log written to {log_path}[/dim]")


if __name__ == "__main__":
    main()
