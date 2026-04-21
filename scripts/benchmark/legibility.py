#!/usr/bin/env python3
"""Readability analysis for LLM consultation summary benchmarks.

For each run_*.json under <results-dir>/<model>/{EN,ES}, concatenates the text
fields of the consultation summary and computes a readability score:

    EN  →  Flesch-Kincaid Grade Level (textstat)    target: grade 6-8
    ES  →  INFLESZ / Flesch-Szigriszt (textstat)    target: > 55

Reports per-run scores plus mean and standard deviation by language.

Usage:
    python legibility.py [--results-dir ./results] [--model gpt-oss:20b]

Requires: pip install textstat
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

try:
    import textstat
except ImportError:
    print("ERROR: 'textstat' package required. Install with: pip install textstat")
    sys.exit(1)


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


def load_runs(lang_dir: Path) -> list[tuple[int, str]]:
    """Return list of (run_number, flattened_text) for each run_*.json."""
    runs: list[tuple[int, str]] = []
    for run_file in sorted(lang_dir.glob("run_*.json")):
        try:
            data = json.loads(run_file.read_text())
        except json.JSONDecodeError as e:
            print(f"  [skip] {run_file.name}: invalid JSON ({e})")
            continue

        response = data.get("response")
        if not isinstance(response, dict):
            print(f"  [skip] {run_file.name}: no structured response")
            continue

        text = extract_text(response)
        if not text:
            print(f"  [skip] {run_file.name}: empty text")
            continue

        runs.append((int(data.get("run", 0)), text))
    return runs


def analyse_language(
    lang: str, lang_dir: Path
) -> tuple[list[tuple[int, float]], float | None, float | None]:
    """Score each run, return (per_run_scores, mean, stdev)."""
    runs = load_runs(lang_dir)
    if not runs:
        return [], None, None

    scorer = score_english if lang == "EN" else score_spanish
    scored = [(run_id, scorer(text)) for run_id, text in runs]
    values = [s for _, s in scored]
    mean = statistics.mean(values)
    stdev = statistics.stdev(values) if len(values) > 1 else 0.0
    return scored, mean, stdev


def format_en_row(run_id: int, score: float) -> str:
    lo, hi = FK_GRADE_TARGET
    status = "OK" if lo <= score <= hi else ("HIGH" if score > hi else "LOW")
    return f"  run {run_id:03d}:  FK grade {score:6.2f}  [{status}]"


def format_es_row(run_id: int, score: float) -> str:
    status = "OK" if score >= INFLESZ_TARGET_MIN else "LOW"
    return f"  run {run_id:03d}:  INFLESZ  {score:6.2f}  ({inflesz_band(score)}) [{status}]"


def print_report(
    model: str,
    en_scores: list[tuple[int, float]],
    en_mean: float | None,
    en_stdev: float | None,
    es_scores: list[tuple[int, float]],
    es_mean: float | None,
    es_stdev: float | None,
) -> None:
    print(f"\nReadability analysis — model: {model}")
    print("=" * 60)

    print("\nEN — Flesch-Kincaid Grade Level (target: grade 6-8)")
    if en_scores:
        for run_id, score in en_scores:
            print(format_en_row(run_id, score))
        print(f"  {'-' * 40}")
        print(f"  mean  = {en_mean:6.2f}   stdev = {en_stdev:6.2f}   n = {len(en_scores)}")
        lo, hi = FK_GRADE_TARGET
        hit = "within" if lo <= en_mean <= hi else "outside"
        print(f"  mean is {hit} target band {lo}-{hi}")
    else:
        print("  (no runs found)")

    print("\nES — INFLESZ / Flesch-Szigriszt (target: > 55)")
    if es_scores:
        for run_id, score in es_scores:
            print(format_es_row(run_id, score))
        print(f"  {'-' * 40}")
        print(
            f"  mean  = {es_mean:6.2f}   stdev = {es_stdev:6.2f}   n = {len(es_scores)}   "
            f"band: {inflesz_band(es_mean)}"
        )
        hit = "meets" if es_mean > INFLESZ_TARGET_MIN else "below"
        print(f"  mean {hit} target > {INFLESZ_TARGET_MIN}")
    else:
        print("  (no runs found)")

    print()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Readability analysis (FK for EN, INFLESZ for ES) "
        "for LLM consultation summary benchmarks."
    )
    parser.add_argument(
        "--results-dir",
        default="./results",
        help="Directory with benchmark results (default: ./results relative to script)",
    )
    parser.add_argument(
        "--model",
        default="gpt-oss:20b",
        help="Model name to analyse (default: gpt-oss:20b)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit results as JSON on stdout instead of the human report",
    )
    args = parser.parse_args()

    results_dir = Path(args.results_dir)
    if not results_dir.is_absolute():
        results_dir = Path(__file__).parent / results_dir

    model_dir_name = args.model.replace(":", "_").replace("/", "_")
    model_dir = results_dir / model_dir_name

    if not model_dir.exists():
        print(f"ERROR: model directory not found: {model_dir}")
        sys.exit(1)

    en_scores, en_mean, en_stdev = analyse_language("EN", model_dir / "EN")
    es_scores, es_mean, es_stdev = analyse_language("ES", model_dir / "ES")

    if args.json:
        output = {
            "model": args.model,
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
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return

    print_report(
        args.model, en_scores, en_mean, en_stdev, es_scores, es_mean, es_stdev
    )


if __name__ == "__main__":
    main()
