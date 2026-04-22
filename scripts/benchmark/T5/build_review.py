#!/usr/bin/env python3
"""
T5 - Build a hallucination-review markdown
==========================================

Renders a single markdown document with everything a reviewer needs to fill
out ``hallucinations.csv``: the EN and ES reference transcripts (collapsed at
the top) plus, for every pending run, each output field broken into individual
claims so they can be checked against the transcript one by one.

Runs already scored in the CSV are skipped. Naive rows are skipped regardless
— the naive baseline copies the transcript verbatim, so its hallucination rate
is 0 by construction.

Usage
-----
    python build_review.py
    python build_review.py --output review.md
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SUMMARY_FIELDS_DISPLAY = [
    ("whatHappened", "What happened"),
    ("diagnosis", "Diagnosis"),
    ("treatmentPlan", "Treatment plan"),
    ("followUp", "Follow-up"),
    ("warningSigns", "Warning signs"),
    ("additionalNotes", "Additional notes"),
]

# Where each condition's runs live. Naive is intentionally absent — its
# hallucination rate is pre-filled in the CSV and does not need manual review.
CONDITION_PATHS = {
    "local": ("results/gpt-oss_20b", "gpt-oss (local)"),
    "gpt-4o": ("results-gpt-4o/gpt-4o", "GPT-4o (cloud)"),
}


def split_claims(text: str) -> list[str]:
    """Break a free-text field into individual claims for line-by-line review."""
    if not text:
        return []
    # Split on sentence terminators (., !, ?, ;) and hard line breaks. Keep the
    # terminator attached to the claim by using a look-behind.
    parts = re.split(r"(?<=[.!?;])\s+|\n+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def format_field(label: str, value) -> list[str]:
    lines: list[str] = []
    if value is None:
        lines.append(f"**{label}**: _(none)_")
        return lines
    if isinstance(value, list):
        if not value:
            lines.append(f"**{label}**: _(empty list)_")
            return lines
        lines.append(f"**{label}** ({len(value)} items):")
        for item in value:
            lines.append(f"- {item}")
        return lines
    claims = split_claims(str(value))
    if not claims:
        lines.append(f"**{label}**: _(empty)_")
        return lines
    lines.append(f"**{label}** ({len(claims)} claims):")
    for claim in claims:
        lines.append(f"- {claim}")
    return lines


def load_pending(csv_path: Path) -> list[tuple[str, str, int]]:
    pending: list[tuple[str, str, int]] = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cond = row["condition"].strip()
            if cond == "naive":
                continue
            if row["total_claims"].strip() and row["hallucinated_claims"].strip():
                continue
            pending.append((cond, row["language"].strip(), int(row["run"])))
    return pending


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    benchmark_dir = script_dir.parent

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1].strip())
    parser.add_argument("--csv", default=str(script_dir / "hallucinations.csv"))
    parser.add_argument("--output", default=str(script_dir / "review.md"))
    parser.add_argument(
        "--en-transcript",
        default=str(benchmark_dir / "EN-user-prompt.txt"),
        help="EN reference transcript (default: ../EN-user-prompt.txt)",
    )
    parser.add_argument(
        "--es-transcript",
        default=str(benchmark_dir / "T4" / "ES-transcript.txt"),
        help="ES reference transcript (default: ../T4/ES-transcript.txt)",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv).resolve()
    out_path = Path(args.output).resolve()
    en_path = Path(args.en_transcript).resolve()
    es_path = Path(args.es_transcript).resolve()

    if not csv_path.is_file():
        print(f"ERROR: {csv_path} not found. Run compare_conditions.py first.", file=sys.stderr)
        sys.exit(1)

    pending = load_pending(csv_path)
    if not pending:
        print("All non-naive rows in hallucinations.csv are already filled. Nothing to render.")
        return

    lines: list[str] = []
    lines.append("# Hallucination review")
    lines.append("")
    lines.append(
        f"{len(pending)} runs pending manual review. "
        f"Naive rows are auto-filled (transcript-verbatim baseline has 0 hallucinations by construction)."
    )
    lines.append("")
    lines.append("## How to use")
    lines.append("")
    lines.append(
        "For each run, compare every factual claim in the generated output against the "
        "corresponding reference transcript below. Count:"
    )
    lines.append("")
    lines.append(
        "- **total_claims** — statements of fact about the consultation, patient, diagnosis, "
        "treatment, or follow-up. Each bulleted line below is already a claim candidate, "
        "but you may split or merge as you see fit."
    )
    lines.append(
        "- **hallucinated_claims** — claims that cannot be traced to the transcript "
        "(content invented, inferred beyond what was said, or contradicting what was said)."
    )
    lines.append("")
    lines.append(
        "Fill the `total_claims` and `hallucinated_claims` columns for the matching row "
        "in `hallucinations.csv`, then rerun `python compare_conditions.py` to refresh the table."
    )
    lines.append("")

    lines.append("## Reference transcripts")
    lines.append("")
    for lang, path in (("EN", en_path), ("ES", es_path)):
        if not path.is_file():
            lines.append(f"_{lang} transcript not found at {path}_")
            lines.append("")
            continue
        lines.append(f"<details><summary><strong>{lang}</strong> — <code>{path.name}</code></summary>")
        lines.append("")
        lines.append("```")
        lines.append(path.read_text(encoding="utf-8").rstrip())
        lines.append("```")
        lines.append("")
        lines.append("</details>")
        lines.append("")

    lines.append("## Runs pending review")
    lines.append("")

    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for cond, lang, run in pending:
        groups[(cond, lang)].append(run)

    for (cond, lang) in sorted(groups.keys()):
        cond_rel, cond_label = CONDITION_PATHS[cond]
        runs = sorted(groups[(cond, lang)])
        lines.append(f"### {cond_label} — {lang}  ({len(runs)} runs)")
        lines.append("")

        for run in runs:
            run_file = benchmark_dir / cond_rel / lang / f"run_{run:03d}.json"
            try:
                data = json.loads(run_file.read_text(encoding="utf-8"))
            except (FileNotFoundError, json.JSONDecodeError) as e:
                lines.append(f"#### `{cond}` · {lang} · run {run:03d} — _unavailable ({e})_")
                lines.append("")
                continue
            response = data.get("response") or {}

            lines.append(f"#### `{cond}` · {lang} · run {run:03d}")
            lines.append("")
            lines.append(f"_source: `{cond_rel}/{lang}/run_{run:03d}.json`_")
            lines.append("")

            for key, label in SUMMARY_FIELDS_DISPLAY:
                lines.extend(format_field(label, response.get(key)))
                lines.append("")

            lines.append(
                f"> **Review:** `{cond},{lang},{run}` → total_claims = ___ · "
                f"hallucinated_claims = ___ · rate = ___ %"
            )
            lines.append("")
            lines.append("---")
            lines.append("")

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"  {len(pending)} runs rendered across {len(groups)} (condition, language) groups")


if __name__ == "__main__":
    main()
