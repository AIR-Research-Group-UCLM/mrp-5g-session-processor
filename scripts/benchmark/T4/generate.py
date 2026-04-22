#!/usr/bin/env python3
"""
T4 - Naive baseline
===================

Concatenates the raw professional-pipeline extraction (tagged consultation
transcripts) into the shared summary-JSON schema — same sections, same speaker
attributions, no LLM rewriting. Emits 5 identical runs per language so the
deterministic baseline slots into the same mean/stdev tooling as the other
conditions.

Usage
-----
    python generate.py
    python generate.py --prompt-dir .. --output-root ../results-naive --runs 5
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

# Matches "[section] SPEAKER: text" — the format every benchmark prompt uses.
LINE_RE = re.compile(r"^\[([^\]]+)\]\s+([A-Z]+):\s+(.*)$")

SECTION_TO_FIELD = {
    "introduction": "whatHappened",
    "symptoms": "whatHappened",
    "diagnosis": "diagnosis",
    "treatment": "treatmentPlan",
    "closing": "followUp",
}

LANGS = ("EN", "ES")


def parse_transcript(path: Path) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = defaultdict(list)
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        m = LINE_RE.match(line)
        if not m:
            continue
        section, speaker, text = m.groups()
        sections[section].append(f"{speaker}: {text}")
    return sections


def build_response(sections: dict[str, list[str]]) -> dict:
    buckets: dict[str, list[str]] = defaultdict(list)
    for section, field in SECTION_TO_FIELD.items():
        buckets[field].extend(sections.get(section, []))

    empty = "No specific information was discussed"
    return {
        "whatHappened": "\n".join(buckets["whatHappened"]) or empty,
        "diagnosis": "\n".join(buckets["diagnosis"]) or empty,
        "treatmentPlan": "\n".join(buckets["treatmentPlan"]) or empty,
        "followUp": "\n".join(buckets["followUp"]) or empty,
        "warningSigns": [],
        "additionalNotes": None,
    }


def write_run(out_dir: Path, run: int, lang: str, model: str, response: dict) -> Path:
    raw_content = json.dumps(response, ensure_ascii=False, indent=2)
    payload = {
        "model": model,
        "language": lang,
        "run": run,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "wall_clock_s": 0.0,
        "eval_duration_s": 0.0,
        "eval_count": 0,
        "tokens_per_second": 0.0,
        "valid_json": True,
        "response": response,
        "raw_content": raw_content,
    }
    path = out_dir / f"run_{run:03d}.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    benchmark_dir = script_dir.parent

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1].strip())
    parser.add_argument(
        "--prompt-dir",
        default=str(benchmark_dir),
        help="Directory containing {EN,ES}-user-prompt.txt (default: ../)",
    )
    parser.add_argument(
        "--output-root",
        default=str(benchmark_dir / "results-naive"),
        help="Root directory for naive results (default: ../results-naive)",
    )
    parser.add_argument(
        "--model-name",
        default="naive",
        help="Label used as the model name in the output JSON and folder path (default: naive)",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=5,
        help="Number of (identical) runs to emit per language (default: 5)",
    )
    args = parser.parse_args()

    prompt_dir = Path(args.prompt_dir).resolve()
    output_root = Path(args.output_root).resolve()
    model_dir_name = args.model_name.replace(":", "_").replace("/", "_")

    print("=== T4 - Naive baseline generator ===")
    print(f"  prompt dir  : {prompt_dir}")
    print(f"  output root : {output_root}")
    print(f"  model name  : {args.model_name}")
    print(f"  runs / lang : {args.runs}")
    print()

    # A T4-local transcript (e.g. T4/ES-transcript.txt) takes priority over the
    # shared benchmark prompt. This lets the naive baseline swap in a
    # Spanish-translated transcript for ES while EN keeps reading the canonical
    # EN-user-prompt.txt — needed because INFLESZ is meaningless on English text.
    total = 0
    for lang in LANGS:
        override = script_dir / f"{lang}-transcript.txt"
        prompt_path = override if override.is_file() else prompt_dir / f"{lang}-user-prompt.txt"
        if not prompt_path.is_file():
            print(f"ERROR: {prompt_path} not found", file=sys.stderr)
            sys.exit(1)
        sections = parse_transcript(prompt_path)
        tagged_lines = sum(len(v) for v in sections.values())
        print(f"[{lang}] parsed {tagged_lines} tagged lines from {prompt_path.name}")

        response = build_response(sections)
        out_dir = output_root / model_dir_name / lang
        out_dir.mkdir(parents=True, exist_ok=True)

        for run in range(1, args.runs + 1):
            path = write_run(out_dir, run, lang, args.model_name, response)
            total += 1
            print(f"  wrote {path.relative_to(output_root.parent)}")

    print()
    print(f"=== Done. {total} files written under {output_root} ===")


if __name__ == "__main__":
    main()
