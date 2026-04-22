#!/usr/bin/env python3
"""
T5 - Comparative table (naive / local / GPT-4o)
===============================================

Aggregates three summary-generation conditions into the paper's headline
trade-off table. Each condition is scored on:

  1. Readability       (EN: Flesch-Kincaid grade;  ES: INFLESZ / Szigriszt-Pazos)
  2. Clinical coverage (diagnosis present, medication + dose, follow-up mention)
  3. Hallucination rate (share of claims not traceable to the transcript —
                         sourced from a manually-reviewed CSV)

(1) and (2) are fully automated. (3) requires human review: the script reads
``hallucinations.csv`` next to this file; if it does not exist, a pre-populated
template is generated so every (condition, language, run) already has a row
waiting for `total_claims` and `hallucinated_claims`. Until those columns are
filled the hallucination column prints "pending".

The script deliberately mirrors T2's structure so readability numbers reconcile
bit-for-bit across the two analyses.

Usage
-----
    python compare_conditions.py
    python compare_conditions.py \\
        --naive-dir   ../results-naive/naive \\
        --local-dir   ../results/gpt-oss_20b \\
        --online-dir  ../results-gpt-4o/gpt-4o \\
        --output-json T5_summary.json

Requires: pip install textstat rich
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

# Reuse T2's readability scorers and field list so the two analyses can never
# drift (same constants, same flattening rules).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "T2"))
from legibility import (  # noqa: E402
    SUMMARY_FIELDS,
    extract_text,
    score_english,
    score_spanish,
)

try:
    from rich.console import Console
    from rich.table import Table
except ImportError:
    print("ERROR: 'rich' package required. Install with: pip install rich")
    sys.exit(1)


console = Console(record=True, width=160)

LANGS = ("EN", "ES")

# Student's-t critical values (two-tailed, alpha = 0.05) used for small-n
# confidence intervals. Covers the benchmark's n=5 cleanly; falls back to the
# normal approximation (1.96) for larger n.
T_CRITICAL = {
    2: 12.706,
    3: 4.303,
    4: 3.182,
    5: 2.776,
    6: 2.571,
    7: 2.447,
    8: 2.365,
    9: 2.306,
    10: 2.262,
}

# ---------------------------------------------------------------------------
# Readability
# ---------------------------------------------------------------------------

FK_GRADE_TARGET = (6.0, 8.0)
INFLESZ_TARGET_MIN = 55.0


# ---------------------------------------------------------------------------
# Clinical completeness (regex-based, language-aware).
# ---------------------------------------------------------------------------

# Only meant to catch common phrasings in this benchmark's eczema scenario; the
# point is a consistent-across-conditions signal, not clinical NER.
DIAGNOSIS_TERMS_EN = re.compile(
    r"\b(eczema|dermatitis|rash|infection|psoriasis|tinea|fungal|nummular|"
    r"allergy|allergic|condition|disease|disorder|diagnos(is|ed))\b",
    re.IGNORECASE,
)
DIAGNOSIS_TERMS_ES = re.compile(
    r"\b(eczema|eccema|dermatitis|sarpullido|erupci[oó]n|infecci[oó]n|psoriasis|"
    r"tinea|micosis|hongos|n[úu]mular|alergia|al[eé]rgico|enfermedad|trastorno|"
    r"diagn[oó]stic[oa])\b",
    re.IGNORECASE,
)

MED_TERMS_EN = re.compile(
    r"\b(steroid|corticosteroid|anti[- ]?inflammatory|cream|ointment|"
    r"moisturi[sz]er|emollient|antibiotic|antifungal|medication|medicine|"
    r"tablet|pill|capsule|prescription)\b",
    re.IGNORECASE,
)
MED_TERMS_ES = re.compile(
    r"\b(esteroide|corticoesteroide|corticoide|antiinflamatorio|crema|pomada|"
    r"ung[üu]ento|humectante|hidratante|emoliente|antibi[oó]tico|antif[úu]ngico|"
    r"medicaci[oó]n|medicamento|pastilla|c[aá]psula|receta)\b",
    re.IGNORECASE,
)

DOSE_PATTERN_EN = re.compile(
    r"(once\s+daily|twice\s+daily|three\s+times|\d+\s*mg|"
    r"\d+\s*times?\s*(?:a|per)\s*day|for\s+\d+\s+(?:weeks?|days?|months?)|"
    r"daily|every\s+\d+\s+hours?|two\s+weeks|three\s+weeks|one\s+week)",
    re.IGNORECASE,
)
DOSE_PATTERN_ES = re.compile(
    r"(una\s+vez\s+al\s+d[ií]a|dos\s+veces\s+al\s+d[ií]a|tres\s+veces\s+al\s+d[ií]a|"
    r"\d+\s*mg|diaria|diariamente|durante\s+\d+\s+(?:d[ií]as?|semanas?|meses?)|"
    r"cada\s+\d+\s+horas?|dos\s+semanas|tres\s+semanas|una\s+semana)",
    re.IGNORECASE,
)

FOLLOWUP_PATTERN_EN = re.compile(
    r"\b(\d+\s+(?:weeks?|days?|months?)|follow[- ]?up|appointment|return|"
    r"come\s+back|next\s+visit|reassess|schedul|in\s+(?:a|one|two|three|four|five|six)\s+weeks?)",
    re.IGNORECASE,
)
FOLLOWUP_PATTERN_ES = re.compile(
    r"\b(\d+\s+(?:semanas?|d[ií]as?|meses?)|seguimiento|cita|regresar|volver|"
    r"pr[oó]xima\s+visita|reevaluar|agendar|en\s+(?:una|dos|tres|cuatro|cinco|seis)\s+semanas?)",
    re.IGNORECASE,
)


EMPTY_MARKER = "No specific information was discussed"


def field_text(response: dict, field: str) -> str:
    value = response.get(field)
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(str(v) for v in value if v)
    text = str(value).strip()
    # Treat the canonical empty marker as absent, whatever language it was
    # filled in (a few models echo it verbatim; naive emits it when a section
    # was not present at all).
    if text.lower().startswith(EMPTY_MARKER.lower()) or text.startswith(
        "No se discutió información"
    ):
        return ""
    return text


def _any(text: str, *patterns: re.Pattern[str]) -> bool:
    return any(p.search(text) for p in patterns)


# Completeness is a content property, not a language property — the naive ES
# baseline dumps an English transcript, so checking only the ES regex would
# under-count. Run both; if either fires, the info is present.
def score_diagnosis(response: dict) -> int:
    text = field_text(response, "diagnosis")
    if not text:
        return 0
    return 1 if _any(text, DIAGNOSIS_TERMS_EN, DIAGNOSIS_TERMS_ES) else 0


def score_medication_with_dose(response: dict) -> int:
    text = field_text(response, "treatmentPlan")
    if not text:
        return 0
    has_med = _any(text, MED_TERMS_EN, MED_TERMS_ES)
    has_dose = _any(text, DOSE_PATTERN_EN, DOSE_PATTERN_ES)
    return 1 if (has_med and has_dose) else 0


def score_followup(response: dict) -> int:
    text = field_text(response, "followUp")
    if not text:
        # Fall back to additionalNotes — some models stuff follow-up plans there.
        text = field_text(response, "additionalNotes")
        if not text:
            return 0
    return 1 if _any(text, FOLLOWUP_PATTERN_EN, FOLLOWUP_PATTERN_ES) else 0


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RunScore:
    condition: str
    language: str
    run: int
    readability: float
    diagnosis: int
    medication_with_dose: int
    followup: int


def load_condition(condition: str, cond_dir: Path) -> tuple[list[RunScore], list[str]]:
    """Score every run_*.json under cond_dir/{EN,ES}/."""
    scores: list[RunScore] = []
    notes: list[str] = []

    if not cond_dir.exists():
        notes.append(f"{condition}: directory not found ({cond_dir})")
        return scores, notes

    for lang in LANGS:
        lang_dir = cond_dir / lang
        if not lang_dir.exists():
            notes.append(f"{condition}/{lang}: directory missing ({lang_dir})")
            continue

        for run_file in sorted(lang_dir.glob("run_*.json")):
            try:
                data = json.loads(run_file.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                notes.append(f"{condition}/{lang}/{run_file.name}: invalid JSON ({e})")
                continue

            response = data.get("response")
            if not isinstance(response, dict):
                notes.append(f"{condition}/{lang}/{run_file.name}: no structured response")
                continue

            text = extract_text(response)
            if not text:
                notes.append(f"{condition}/{lang}/{run_file.name}: empty text")
                continue

            scorer = score_english if lang == "EN" else score_spanish
            scores.append(
                RunScore(
                    condition=condition,
                    language=lang,
                    run=int(data.get("run", 0)),
                    readability=scorer(text),
                    diagnosis=score_diagnosis(response),
                    medication_with_dose=score_medication_with_dose(response),
                    followup=score_followup(response),
                )
            )
    return scores, notes


# ---------------------------------------------------------------------------
# Hallucinations: CSV-backed manual review
# ---------------------------------------------------------------------------


HALLUCINATION_FIELDS = [
    "condition",
    "language",
    "run",
    "total_claims",
    "hallucinated_claims",
    "notes",
]


def load_hallucinations(csv_path: Path) -> dict[tuple[str, str, int], tuple[int, int]]:
    """Return {(condition, lang, run): (total, hallucinated)} for filled rows only."""
    out: dict[tuple[str, str, int], tuple[int, int]] = {}
    if not csv_path.exists():
        return out
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                total = row["total_claims"].strip()
                halluc = row["hallucinated_claims"].strip()
                if not total or not halluc:
                    continue
                key = (row["condition"].strip(), row["language"].strip(), int(row["run"]))
                out[key] = (int(total), int(halluc))
            except (KeyError, ValueError):
                continue
    return out


def write_hallucination_template(csv_path: Path, scored: list[RunScore]) -> None:
    """Emit one row per (condition, language, run). Naive rows are pre-filled
    at 0 hallucinations because the baseline copies the transcript verbatim —
    every claim is trivially traceable."""
    keys = sorted({(s.condition, s.language, s.run) for s in scored})
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=HALLUCINATION_FIELDS)
        writer.writeheader()
        for cond, lang, run in keys:
            row = {
                "condition": cond,
                "language": lang,
                "run": run,
                "total_claims": "",
                "hallucinated_claims": "",
                "notes": "",
            }
            if cond == "naive":
                row["total_claims"] = "1"
                row["hallucinated_claims"] = "0"
                row["notes"] = "auto: naive copies transcript verbatim"
            writer.writerow(row)


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


@dataclass
class AggregateRow:
    condition: str
    language: str
    n: int
    readability_mean: float | None
    readability_stdev: float | None
    readability_ci: float | None
    diagnosis_pct: float | None
    medication_pct: float | None
    followup_pct: float | None
    hallucination_mean: float | None
    hallucination_stdev: float | None
    hallucination_ci: float | None
    hallucination_n: int


def _mean_ci(values: list[float]) -> tuple[float, float, float]:
    """Return (mean, stdev, halfwidth-95CI) using Student's-t for small n."""
    mean = statistics.mean(values)
    stdev = statistics.stdev(values) if len(values) > 1 else 0.0
    n = len(values)
    if n < 2:
        return mean, stdev, 0.0
    t = T_CRITICAL.get(n, 1.96)
    half = t * stdev / math.sqrt(n)
    return mean, stdev, half


def aggregate(
    scored: list[RunScore],
    halluc: dict[tuple[str, str, int], tuple[int, int]],
) -> list[AggregateRow]:
    keys = sorted({(s.condition, s.language) for s in scored})
    rows: list[AggregateRow] = []
    for cond, lang in keys:
        runs = [s for s in scored if s.condition == cond and s.language == lang]
        if not runs:
            continue

        read_vals = [r.readability for r in runs]
        read_mean, read_stdev, read_ci = _mean_ci(read_vals)

        n = len(runs)
        diag_pct = 100.0 * sum(r.diagnosis for r in runs) / n
        med_pct = 100.0 * sum(r.medication_with_dose for r in runs) / n
        fu_pct = 100.0 * sum(r.followup for r in runs) / n

        halluc_rates: list[float] = []
        for r in runs:
            key = (r.condition, r.language, r.run)
            if key not in halluc:
                continue
            total, hallucinated = halluc[key]
            if total <= 0:
                continue
            halluc_rates.append(100.0 * hallucinated / total)

        if halluc_rates:
            h_mean, h_stdev, h_ci = _mean_ci(halluc_rates)
        else:
            h_mean = h_stdev = h_ci = None

        rows.append(
            AggregateRow(
                condition=cond,
                language=lang,
                n=n,
                readability_mean=read_mean,
                readability_stdev=read_stdev,
                readability_ci=read_ci,
                diagnosis_pct=diag_pct,
                medication_pct=med_pct,
                followup_pct=fu_pct,
                hallucination_mean=h_mean,
                hallucination_stdev=h_stdev,
                hallucination_ci=h_ci,
                hallucination_n=len(halluc_rates),
            )
        )
    return rows


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def _fmt_metric(mean: float | None, ci: float | None, fmt: str = "{:.2f}") -> str:
    if mean is None:
        return "—"
    if ci is None or ci == 0.0:
        return fmt.format(mean)
    return f"{fmt.format(mean)} ± {fmt.format(ci)}"


def _fmt_pct(pct: float | None) -> str:
    if pct is None:
        return "—"
    return f"{pct:5.1f}%"


def _fmt_halluc(mean: float | None, ci: float | None, n: int) -> str:
    if mean is None:
        return "[yellow]pending[/yellow]"
    base = _fmt_metric(mean, ci, "{:.1f}") + "%"
    return f"{base}  [dim](n={n})[/dim]"


def _readability_label(lang: str) -> str:
    return "FK grade" if lang == "EN" else "INFLESZ"


def _readability_target_note(lang: str) -> str:
    lo, hi = FK_GRADE_TARGET
    if lang == "EN":
        return f"target {lo:g}-{hi:g}, lower = simpler"
    return f"target > {INFLESZ_TARGET_MIN:g}, higher = simpler"


def print_preamble(
    naive_dir: Path,
    local_dir: Path,
    online_dir: Path,
    halluc_path: Path,
    halluc_rows: int,
) -> None:
    console.rule("[bold]T5 - Comparative table: naive / local / GPT-4o[/bold]")
    console.print(
        "\n[bold]What this measures[/bold]\n"
        "  Three summary-generation conditions, scored on three axes so the\n"
        "  privacy/quality trade-off sits in a single table. Readability and\n"
        "  clinical completeness are automated; hallucination rate comes from a\n"
        "  manually-reviewed CSV (see below).\n"
    )
    console.print(
        "[bold]Metrics[/bold]\n"
        "  Readability  - EN: Flesch-Kincaid grade (target 6-8); ES: INFLESZ > 55.\n"
        "  Diagnosis    - share of runs whose diagnosis field names a condition.\n"
        "  Medication   - share of runs with a drug + dose/frequency pair.\n"
        "  Follow-up    - share of runs with a concrete time or appointment.\n"
        "  Hallucination- manual review: (hallucinated claims / total claims).\n"
    )
    console.print(
        "[bold]Conditions[/bold]\n"
        f"  naive   : {naive_dir}\n"
        f"  local   : {local_dir}\n"
        f"  gpt-4o  : {online_dir}\n"
    )
    if halluc_rows == 0:
        console.print(
            f"[bold]Hallucination CSV[/bold]\n"
            f"  {halluc_path}\n"
            f"  [yellow]Not found or empty — a template was generated. Fill the\n"
            f"  `total_claims` and `hallucinated_claims` columns and rerun.[/yellow]\n"
        )
    else:
        console.print(
            f"[bold]Hallucination CSV[/bold]\n"
            f"  {halluc_path}  [green]({halluc_rows} rows scored)[/green]\n"
        )
    console.rule()


def render_language(rows: list[AggregateRow], lang: str) -> None:
    subset = [r for r in rows if r.language == lang]
    if not subset:
        console.print(f"[yellow]No data for language {lang}[/yellow]")
        return

    console.print(
        f"\n[bold]{lang}[/bold]  [dim]({_readability_label(lang)}, "
        f"{_readability_target_note(lang)})[/dim]"
    )

    table = Table(show_lines=False)
    table.add_column("Condition", style="cyan")
    table.add_column("n", justify="right", width=4)
    table.add_column(f"Readability ({_readability_label(lang)})", justify="right")
    table.add_column("Diagnosis", justify="right")
    table.add_column("Meds+dose", justify="right")
    table.add_column("Follow-up", justify="right")
    table.add_column("Hallucinations", justify="right")

    # Stable ordering — naive first (baseline), then local, then gpt-4o.
    order = {"naive": 0, "local": 1, "gpt-4o": 2}
    subset.sort(key=lambda r: order.get(r.condition, 99))

    for r in subset:
        table.add_row(
            r.condition,
            str(r.n),
            _fmt_metric(r.readability_mean, r.readability_ci),
            _fmt_pct(r.diagnosis_pct),
            _fmt_pct(r.medication_pct),
            _fmt_pct(r.followup_pct),
            _fmt_halluc(
                r.hallucination_mean, r.hallucination_ci, r.hallucination_n
            ),
        )
    console.print(table)


def render_run_detail(scored: list[RunScore], lang: str) -> None:
    subset = [s for s in scored if s.language == lang]
    if not subset:
        return
    order = {"naive": 0, "local": 1, "gpt-4o": 2}
    subset.sort(key=lambda s: (order.get(s.condition, 99), s.run))

    console.print(f"\n[dim]{lang} per-run detail[/dim]")
    table = Table(show_lines=False, box=None, pad_edge=False)
    table.add_column("Cond", style="cyan")
    table.add_column("Run", justify="right", width=4)
    table.add_column(f"Readability", justify="right")
    table.add_column("Dx", justify="center", width=4)
    table.add_column("Rx+dose", justify="center", width=8)
    table.add_column("FU", justify="center", width=4)
    for s in subset:
        table.add_row(
            s.condition,
            f"{s.run:03d}",
            f"{s.readability:6.2f}",
            "Y" if s.diagnosis else "-",
            "Y" if s.medication_with_dose else "-",
            "Y" if s.followup else "-",
        )
    console.print(table)


def write_json(path: Path, rows: list[AggregateRow], halluc_path: Path) -> None:
    payload = {
        "hallucination_csv": str(halluc_path),
        "conditions": [
            {
                "condition": r.condition,
                "language": r.language,
                "n": r.n,
                "readability": {
                    "mean": r.readability_mean,
                    "stdev": r.readability_stdev,
                    "ci_halfwidth_95": r.readability_ci,
                    "metric": "flesch_kincaid_grade" if r.language == "EN" else "inflesz_szigriszt_pazos",
                },
                "diagnosis_pct": r.diagnosis_pct,
                "medication_with_dose_pct": r.medication_pct,
                "followup_pct": r.followup_pct,
                "hallucinations": {
                    "n_reviewed": r.hallucination_n,
                    "mean_pct": r.hallucination_mean,
                    "stdev_pct": r.hallucination_stdev,
                    "ci_halfwidth_95_pct": r.hallucination_ci,
                },
            }
            for r in rows
        ],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    benchmark_dir = script_dir.parent

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1].strip())
    parser.add_argument(
        "--naive-dir",
        default=str(benchmark_dir / "results-naive" / "naive"),
        help="naive baseline root (contains EN/ and ES/)",
    )
    parser.add_argument(
        "--local-dir",
        default=str(benchmark_dir / "results" / "gpt-oss_20b"),
        help="local model root (contains EN/ and ES/)",
    )
    parser.add_argument(
        "--online-dir",
        default=str(benchmark_dir / "results-gpt-4o" / "gpt-4o"),
        help="GPT-4o reference root (contains EN/ and ES/)",
    )
    parser.add_argument(
        "--hallucinations-csv",
        default=str(script_dir / "hallucinations.csv"),
        help="CSV with manual hallucination review (auto-generated if missing)",
    )
    parser.add_argument(
        "--output-json",
        default=str(script_dir / "T5_summary.json"),
        help="Where to write the machine-readable summary",
    )
    parser.add_argument(
        "--log-file",
        default=str(script_dir / "T5.log"),
        help="Where to mirror the rendered tables as text",
    )
    parser.add_argument("--no-log", action="store_true", help="Skip writing T5.log")
    parser.add_argument(
        "--no-per-run",
        action="store_true",
        help="Skip the per-run detail tables",
    )
    args = parser.parse_args()

    naive_dir = Path(args.naive_dir).resolve()
    local_dir = Path(args.local_dir).resolve()
    online_dir = Path(args.online_dir).resolve()
    halluc_path = Path(args.hallucinations_csv).resolve()
    out_path = Path(args.output_json).resolve()
    log_path = Path(args.log_file).resolve()

    all_scored: list[RunScore] = []
    all_notes: list[str] = []
    for condition, cond_dir in [
        ("naive", naive_dir),
        ("local", local_dir),
        ("gpt-4o", online_dir),
    ]:
        scored, notes = load_condition(condition, cond_dir)
        all_scored.extend(scored)
        all_notes.extend(notes)

    if not all_scored:
        console.print("[red]ERROR: no runs scored across any condition.[/red]")
        for note in all_notes:
            console.print(f"  [dim]{note}[/dim]")
        sys.exit(1)

    # Ensure the template exists so humans always have somewhere to write
    # review results, but never clobber an already-populated file.
    if not halluc_path.exists():
        write_hallucination_template(halluc_path, all_scored)

    halluc = load_hallucinations(halluc_path)

    print_preamble(naive_dir, local_dir, online_dir, halluc_path, len(halluc))

    aggregated = aggregate(all_scored, halluc)

    for lang in LANGS:
        render_language(aggregated, lang)
        if not args.no_per_run:
            render_run_detail(all_scored, lang)

    if all_notes:
        console.print("\n[dim]Notes[/dim]")
        for note in all_notes:
            console.print(f"  [dim]skip: {note}[/dim]")

    console.print()

    write_json(out_path, aggregated, halluc_path)
    console.print(f"[dim]Summary written to {out_path}[/dim]")

    if not args.no_log:
        console.save_text(str(log_path), clear=False)
        console.print(f"[dim]Log written to {log_path}[/dim]")


if __name__ == "__main__":
    main()
