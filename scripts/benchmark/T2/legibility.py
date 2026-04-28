#!/usr/bin/env python3
"""
T2 - Readability of LLM Consultation Summaries
==============================================

For each run_*.json under <results-dir>/<model>/{EN,ES}, concatenates the
consultation-summary text fields and computes a language-appropriate
readability score:

    EN  ->  Flesch-Kincaid Grade Level (textstat)    target: grade 6-8
    ES  ->  INFLESZ / Flesch-Szigriszt (textstat)    target: > 55

Reports per-run scores plus mean and stdev per language, with visual
status markers against the target band.

Usage
-----
    python legibility.py [--results-dir ../results] [--model gpt-oss:20b] \
                         [--output-json T2_summary.json] [--log-file T2.log]

Requires: pip install textstat rich
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

try:
    from rich.console import Console
    from rich.table import Table
except ImportError:
    print("ERROR: 'rich' package required. Install with: pip install rich")
    sys.exit(1)

try:
    import textstat
except ImportError:
    print("ERROR: 'textstat' package required. Install with: pip install textstat")
    sys.exit(1)


console = Console(record=True, width=140)


SUMMARY_FIELDS = [
    "whatHappened",
    "diagnosis",
    "treatmentPlan",
    "followUp",
    "warningSigns",
    "additionalNotes",
]

# INFLESZ (Barrio-Cantalejo) interpretation bands for the Flesch-Szigriszt index.
INFLESZ_BANDS = [
    (40, "muy difícil"),
    (55, "algo difícil"),
    (65, "normal"),
    (80, "bastante fácil"),
    (float("inf"), "muy fácil"),
]

FK_GRADE_TARGET = (6.0, 8.0)
INFLESZ_TARGET_MIN = 55.0


# --- Scoring ---


def extract_text(response: dict) -> str:
    """Flatten a consultation summary response into a single text block."""
    parts: list[str] = []
    for field in SUMMARY_FIELDS:
        value = response.get(field)
        if value is None:
            continue
        if isinstance(value, list):
            parts.extend(str(item) for item in value if item)
        else:
            parts.append(str(value))
    return "\n".join(parts).strip()


def score_english(text: str) -> float:
    textstat.set_lang("en")
    return float(textstat.flesch_kincaid_grade(text))


def score_spanish(text: str) -> float:
    textstat.set_lang("es")
    return float(textstat.szigriszt_pazos(text))


def inflesz_band(score: float) -> str:
    for upper, label in INFLESZ_BANDS:
        if score < upper:
            return label
    return INFLESZ_BANDS[-1][1]


def load_runs(lang_dir: Path) -> tuple[list[tuple[int, str]], list[str]]:
    """Return (runs, skip_notes) where runs is a list of (run_id, text)."""
    runs: list[tuple[int, str]] = []
    skip_notes: list[str] = []
    if not lang_dir.exists():
        return runs, skip_notes

    for run_file in sorted(lang_dir.glob("run_*.json")):
        try:
            data = json.loads(run_file.read_text())
        except json.JSONDecodeError as e:
            skip_notes.append(f"{run_file.name}: invalid JSON ({e})")
            continue

        response = data.get("response")
        if not isinstance(response, dict):
            skip_notes.append(f"{run_file.name}: no structured response")
            continue

        text = extract_text(response)
        if not text:
            skip_notes.append(f"{run_file.name}: empty text")
            continue

        runs.append((int(data.get("run", 0)), text))
    return runs, skip_notes


def analyse_language(
    lang: str, lang_dir: Path
) -> tuple[list[tuple[int, float]], float | None, float | None, list[str]]:
    """Score each run, return (per_run_scores, mean, stdev, skip_notes)."""
    runs, skip_notes = load_runs(lang_dir)
    if not runs:
        return [], None, None, skip_notes

    scorer = score_english if lang == "EN" else score_spanish
    scored = [(run_id, scorer(text)) for run_id, text in runs]
    values = [s for _, s in scored]
    mean = statistics.mean(values)
    stdev = statistics.stdev(values) if len(values) > 1 else 0.0
    return scored, mean, stdev, skip_notes


# --- Output ---


def print_preamble(
    model: str,
    results_dir: Path,
) -> None:
    """Self-contained explanation of metrics and targets."""
    console.rule(f"[bold]T2 - Readability analysis: {model}[/bold]")
    console.print(
        "\n[bold]What this measures[/bold]\n"
        "  The concatenated text of each consultation summary is scored with a\n"
        "  language-appropriate readability metric. One score per run, then mean\n"
        "  and stdev across runs. The goal is a patient-friendly register.\n"
    )
    console.print(
        "[bold]Metrics and targets[/bold]\n"
        "  EN - Flesch-Kincaid Grade Level (lower = simpler; target grade 6-8).\n"
        "  ES - INFLESZ / Flesch-Szigriszt (higher = simpler; target > 55,\n"
        "       equivalent to 'normal' or better on the Barrio-Cantalejo bands).\n"
    )
    console.print(
        "[bold]How to read the tables[/bold]\n"
        "  - One row per run. Status column flags each run vs. the target band.\n"
        "  - Mean/stdev aggregate across runs for the same model+language.\n"
        "  - A model 'meets target' when the mean sits inside the target band.\n"
    )
    console.print(
        "[bold]Run parameters[/bold]\n"
        f"  model        : {model}\n"
        f"  results dir  : {results_dir}\n"
    )
    console.rule()


def _en_status(score: float) -> str:
    lo, hi = FK_GRADE_TARGET
    if score < lo:
        return "[cyan]LOW[/cyan]"
    if score > hi:
        return "[red]HIGH[/red]"
    return "[green]OK[/green]"


def _es_status(score: float) -> str:
    return "[green]OK[/green]" if score >= INFLESZ_TARGET_MIN else "[red]LOW[/red]"


def render_english(
    scores: list[tuple[int, float]],
    mean: float | None,
    stdev: float | None,
    skips: list[str],
) -> None:
    lo, hi = FK_GRADE_TARGET
    console.print(
        f"\n[bold]EN - Flesch-Kincaid Grade Level[/bold]  "
        f"[dim](target grade {lo:g}-{hi:g}, lower = simpler)[/dim]"
    )
    if not scores:
        console.print("  [yellow](no runs found)[/yellow]")
        for note in skips:
            console.print(f"  [dim]skip: {note}[/dim]")
        return

    table = Table(show_lines=False)
    table.add_column("Run", justify="right", style="cyan", width=6)
    table.add_column("FK grade", justify="right", style="bold")
    table.add_column("Status", justify="center")

    for run_id, score in scores:
        table.add_row(f"{run_id:03d}", f"{score:6.2f}", _en_status(score))

    console.print(table)

    hit = "within" if lo <= mean <= hi else "outside"
    hit_color = "green" if hit == "within" else "red"
    console.print(
        f"  mean = [bold]{mean:6.2f}[/bold]   stdev = {stdev:6.2f}   "
        f"n = {len(scores)}   "
        f"[{hit_color}]mean is {hit} target band {lo:g}-{hi:g}[/{hit_color}]"
    )
    for note in skips:
        console.print(f"  [dim]skip: {note}[/dim]")


def render_spanish(
    scores: list[tuple[int, float]],
    mean: float | None,
    stdev: float | None,
    skips: list[str],
) -> None:
    console.print(
        f"\n[bold]ES - INFLESZ / Flesch-Szigriszt[/bold]  "
        f"[dim](target > {INFLESZ_TARGET_MIN:g}, higher = simpler)[/dim]"
    )
    if not scores:
        console.print("  [yellow](no runs found)[/yellow]")
        for note in skips:
            console.print(f"  [dim]skip: {note}[/dim]")
        return

    table = Table(show_lines=False)
    table.add_column("Run", justify="right", style="cyan", width=6)
    table.add_column("INFLESZ", justify="right", style="bold")
    table.add_column("Band", justify="left")
    table.add_column("Status", justify="center")

    for run_id, score in scores:
        table.add_row(
            f"{run_id:03d}",
            f"{score:6.2f}",
            inflesz_band(score),
            _es_status(score),
        )

    console.print(table)

    hit = "meets" if mean > INFLESZ_TARGET_MIN else "below"
    hit_color = "green" if hit == "meets" else "red"
    console.print(
        f"  mean = [bold]{mean:6.2f}[/bold]   stdev = {stdev:6.2f}   "
        f"n = {len(scores)}   band: {inflesz_band(mean)}   "
        f"[{hit_color}]mean {hit} target > {INFLESZ_TARGET_MIN:g}[/{hit_color}]"
    )
    for note in skips:
        console.print(f"  [dim]skip: {note}[/dim]")


def write_json(
    path: Path,
    model: str,
    en_scores: list[tuple[int, float]],
    en_mean: float | None,
    en_stdev: float | None,
    es_scores: list[tuple[int, float]],
    es_mean: float | None,
    es_stdev: float | None,
) -> None:
    payload = {
        "model": model,
        "EN": {
            "metric": "flesch_kincaid_grade",
            "target": {"min": FK_GRADE_TARGET[0], "max": FK_GRADE_TARGET[1]},
            "runs": [{"run": r, "score": s} for r, s in en_scores],
            "mean": en_mean,
            "stdev": en_stdev,
            "n": len(en_scores),
        },
        "ES": {
            "metric": "inflesz_szigriszt_pazos",
            "target": {"min": INFLESZ_TARGET_MIN},
            "runs": [{"run": r, "score": s} for r, s in es_scores],
            "mean": es_mean,
            "stdev": es_stdev,
            "n": len(es_scores),
            "band": inflesz_band(es_mean) if es_mean is not None else None,
        },
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))


# --- Main ---


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "T2 - Readability analysis (FK grade for EN, INFLESZ for ES) "
            "for LLM consultation summary benchmarks."
        )
    )
    parser.add_argument(
        "--results-dir",
        default="../results",
        help="Directory with benchmark results (default: ../results relative to script)",
    )
    parser.add_argument(
        "--model",
        default="gpt-oss:20b",
        help="Model name to analyse (default: gpt-oss:20b)",
    )
    parser.add_argument(
        "--output-json",
        default=None,
        help="Optional path to write machine-readable summary JSON",
    )
    parser.add_argument(
        "--log-file",
        default="T2.log",
        help="Path to write the plain-text run log (default: T2.log next to script)",
    )
    parser.add_argument(
        "--no-log",
        action="store_true",
        help="Disable writing the T2.log file",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent

    results_dir = Path(args.results_dir)
    if not results_dir.is_absolute():
        results_dir = (script_dir / results_dir).resolve()

    model_dir_name = args.model.replace(":", "_").replace("/", "_")
    model_dir = results_dir / model_dir_name

    if not model_dir.exists():
        console.print(f"[red]ERROR: model directory not found: {model_dir}[/red]")
        sys.exit(1)

    print_preamble(args.model, results_dir)

    en_scores, en_mean, en_stdev, en_skips = analyse_language("EN", model_dir / "EN")
    es_scores, es_mean, es_stdev, es_skips = analyse_language("ES", model_dir / "ES")

    render_english(en_scores, en_mean, en_stdev, en_skips)
    render_spanish(es_scores, es_mean, es_stdev, es_skips)

    console.print()

    if args.output_json:
        out_path = Path(args.output_json)
        if not out_path.is_absolute():
            out_path = (script_dir / out_path).resolve()
        write_json(
            out_path,
            args.model,
            en_scores, en_mean, en_stdev,
            es_scores, es_mean, es_stdev,
        )
        console.print(f"[dim]Summary written to {out_path}[/dim]")

    if not args.no_log:
        log_path = Path(args.log_file)
        if not log_path.is_absolute():
            log_path = (script_dir / log_path).resolve()
        console.save_text(str(log_path), clear=False)
        console.print(f"[dim]Log written to {log_path}[/dim]")


if __name__ == "__main__":
    main()
