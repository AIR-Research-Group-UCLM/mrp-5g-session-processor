#!/usr/bin/env python3
"""Blind A/B comparison tool for LLM consultation summary benchmarks.

Usage:
    python compare.py [--results-dir ./results] [--rounds-per-pair 3] [--lang EN|ES|all]

Requires: pip install rich
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import IntEnum
from itertools import combinations
from pathlib import Path

try:
    from rich.columns import Columns
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
except ImportError:
    print("ERROR: 'rich' package required. Install with: pip install rich")
    sys.exit(1)

console = Console()

# The 6 expected fields from consultation summary JSON
FIELDS = [
    "whatHappened",
    "diagnosis",
    "treatmentPlan",
    "followUp",
    "warningSigns",
    "additionalNotes",
]

FIELD_LABELS = {
    "whatHappened": "What Happened",
    "diagnosis": "Diagnosis",
    "treatmentPlan": "Treatment Plan",
    "followUp": "Follow-Up",
    "warningSigns": "Warning Signs",
    "additionalNotes": "Additional Notes",
}

# Map normalized (lowercase, no separators) → canonical camelCase field name
_CANONICAL_KEY = {f.lower(): f for f in FIELDS}
# Also map common snake_case variants explicitly
_CANONICAL_KEY.update({
    "what_happened": "whatHappened",
    "treatment_plan": "treatmentPlan",
    "follow_up": "followUp",
    "warning_signs": "warningSigns",
    "additional_notes": "additionalNotes",
})


def normalize_keys(response: dict) -> dict:
    """Normalize response keys to canonical camelCase, preserving unrecognized keys."""
    normalized: dict = {}
    for key, value in response.items():
        lookup = key.replace("_", "").replace("-", "").lower()
        # Try exact lowercase match first, then stripped match
        canonical = _CANONICAL_KEY.get(key.lower()) or _CANONICAL_KEY.get(lookup)
        normalized[canonical or key] = value
    return normalized


K_FACTOR = 32
INITIAL_ELO = 1500.0


class Severity(IntEnum):
    CRITICAL = 1  # No JSON extracted at all
    BAD = 2       # JSON extracted but <=3 of 6 FIELDS present
    MINOR = 3     # Only additionalNotes missing or warningSigns not a list
    OK = 4        # All keys present and warningSigns is a list


def classify_severity(response: object) -> Severity:
    """Classify the quality of a consultation summary response."""
    if response is None or not isinstance(response, dict):
        return Severity.CRITICAL

    present = sum(1 for f in FIELDS if f in response)
    if present <= 3:
        return Severity.BAD

    missing_notes = "additionalNotes" not in response
    bad_warnings = "warningSigns" in response and not isinstance(response["warningSigns"], list)
    if missing_notes or bad_warnings:
        return Severity.MINOR

    return Severity.OK


# --- Data structures ---


@dataclass
class RunResult:
    model: str
    language: str
    run: int
    response: dict
    wall_clock_s: float
    tokens_per_second: float
    severity: Severity
    file_path: str


@dataclass
class EloState:
    rating: float = INITIAL_ELO
    wins: int = 0
    losses: int = 0
    ties: int = 0

    @property
    def total_games(self) -> int:
        return self.wins + self.losses + self.ties

    @property
    def win_rate(self) -> float:
        if self.total_games == 0:
            return 0.0
        return self.wins / self.total_games * 100


@dataclass
class ComparisonTask:
    model_a: str
    model_b: str
    language: str


# --- Loading ---


def _print_loading_warnings(
    warnings: list[tuple[Path, Severity, object]],
) -> None:
    """Print colored warnings grouped by severity."""
    if not warnings:
        return

    console.print()
    for file_path, severity, response in warnings:
        rel = file_path.name
        if severity == Severity.CRITICAL:
            snippet = str(response)[:120] if response else "(empty)"
            console.print(
                f"  [bold red]CRITICAL[/bold red] {rel} — "
                f"no usable JSON, skipped. Raw: [dim]{snippet}[/dim]"
            )
        elif severity == Severity.BAD:
            present = sum(1 for f in FIELDS if isinstance(response, dict) and f in response)
            console.print(
                f"  [red]WARNING[/red]  {rel} — "
                f"only {present}/{len(FIELDS)} fields present, included with gaps"
            )
        elif severity == Severity.MINOR:
            issues: list[str] = []
            if isinstance(response, dict):
                if "additionalNotes" not in response:
                    issues.append("additionalNotes missing")
                if "warningSigns" in response and not isinstance(response["warningSigns"], list):
                    issues.append("warningSigns is not a list")
            console.print(
                f"  [yellow]MINOR[/yellow]    {rel} — {', '.join(issues)}"
            )
    console.print()


def load_results(
    results_dir: Path, lang_filter: str
) -> dict[tuple[str, str], list[RunResult]]:
    """Load all run files grouped by (model, language), with severity warnings."""
    results: dict[tuple[str, str], list[RunResult]] = defaultdict(list)
    warnings: list[tuple[Path, Severity, object]] = []

    if not results_dir.exists():
        console.print(f"[red]Results directory not found: {results_dir}[/red]")
        sys.exit(1)

    for model_dir in sorted(results_dir.iterdir()):
        if not model_dir.is_dir():
            continue
        for lang_dir in sorted(model_dir.iterdir()):
            if not lang_dir.is_dir():
                continue
            lang = lang_dir.name
            if lang_filter != "all" and lang.upper() != lang_filter.upper():
                continue
            for run_file in sorted(lang_dir.glob("run_*.json")):
                try:
                    data = json.loads(run_file.read_text())
                    response = data.get("response")
                    if isinstance(response, dict):
                        response = normalize_keys(response)
                    severity = classify_severity(response)

                    if severity == Severity.CRITICAL:
                        raw = data.get("raw_content", response)
                        warnings.append((run_file, severity, raw))
                        continue

                    result = RunResult(
                        model=data["model"],
                        language=data["language"],
                        run=data["run"],
                        response=response,
                        wall_clock_s=data.get("wall_clock_s", 0),
                        tokens_per_second=data.get("tokens_per_second", 0),
                        severity=severity,
                        file_path=str(run_file),
                    )
                    results[(result.model, result.language)].append(result)

                    if severity != Severity.OK:
                        warnings.append((run_file, severity, response))
                except (json.JSONDecodeError, KeyError) as e:
                    console.print(f"[yellow]Skipping {run_file}: {e}[/yellow]")

    _print_loading_warnings(warnings)
    return results


def load_existing_comparisons(jsonl_path: Path) -> list[dict]:
    """Load existing comparisons from JSONL file for resume."""
    if not jsonl_path.exists():
        return []
    comparisons = []
    for line in jsonl_path.read_text().strip().split("\n"):
        if line.strip():
            try:
                comparisons.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return comparisons


# --- ELO ---


def update_elo(state_a: EloState, state_b: EloState, winner: str) -> None:
    """Update ELO ratings. winner is 'a', 'b', or 'tie'."""
    ea = 1.0 / (1.0 + 10 ** ((state_b.rating - state_a.rating) / 400))
    eb = 1.0 - ea

    if winner == "a":
        sa, sb = 1.0, 0.0
        state_a.wins += 1
        state_b.losses += 1
    elif winner == "b":
        sa, sb = 0.0, 1.0
        state_b.wins += 1
        state_a.losses += 1
    else:  # tie
        sa, sb = 0.5, 0.5
        state_a.ties += 1
        state_b.ties += 1

    state_a.rating += K_FACTOR * (sa - ea)
    state_b.rating += K_FACTOR * (sb - eb)


def rebuild_elo(comparisons: list[dict]) -> dict[str, EloState]:
    """Rebuild ELO state by replaying comparison history."""
    elo: dict[str, EloState] = {}

    for comp in comparisons:
        choice = comp.get("choice", "skip")
        if choice in ("S", "skip"):
            continue

        model_a = comp["model_a"]
        model_b = comp["model_b"]

        if model_a not in elo:
            elo[model_a] = EloState()
        if model_b not in elo:
            elo[model_b] = EloState()

        if choice == "A":
            update_elo(elo[model_a], elo[model_b], winner="a")
        elif choice == "B":
            update_elo(elo[model_a], elo[model_b], winner="b")
        elif choice == "T":
            update_elo(elo[model_a], elo[model_b], winner="tie")

    return elo


# --- Queue generation ---


def count_completed_pairs(
    comparisons: list[dict],
) -> dict[tuple[str, str, str], int]:
    """Count completed (non-skipped) comparisons per (model1, model2, lang) triple."""
    counts: dict[tuple[str, str, str], int] = defaultdict(int)
    for comp in comparisons:
        choice = comp.get("choice", "skip")
        if choice in ("S", "skip"):
            continue
        m_a, m_b = comp["model_a"], comp["model_b"]
        lang = comp.get("language", "")
        pair_key = (*tuple(sorted([m_a, m_b])), lang)
        counts[pair_key] += 1
    return counts


def generate_comparison_queue(
    results: dict[tuple[str, str], list[RunResult]],
    rounds_per_pair: int,
    completed: dict[tuple[str, str, str], int],
) -> list[ComparisonTask]:
    """Generate round-robin pairs per language, randomize A/B, shuffle."""
    queue: list[ComparisonTask] = []

    # Group models by language
    models_by_lang: dict[str, list[str]] = defaultdict(list)
    for model, lang in results.keys():
        if model not in models_by_lang[lang]:
            models_by_lang[lang].append(model)

    for lang, models in models_by_lang.items():
        models_sorted = sorted(models)
        for m1, m2 in combinations(models_sorted, 2):
            pair_key = (m1, m2, lang)
            done = completed.get(pair_key, 0)
            remaining = max(0, rounds_per_pair - done)
            for _ in range(remaining):
                # Randomize which model is shown as A vs B
                if random.random() < 0.5:
                    queue.append(ComparisonTask(model_a=m1, model_b=m2, language=lang))
                else:
                    queue.append(ComparisonTask(model_a=m2, model_b=m1, language=lang))

    random.shuffle(queue)
    return queue


# --- Display ---


def format_response_panel(
    response: dict, label: str, severity: Severity = Severity.OK
) -> Panel:
    """Format a consultation summary response as a rich Panel."""
    parts: list[str] = []

    if severity == Severity.BAD:
        parts.append("[red]\u26a0 Incomplete JSON[/red]")
        parts.append("")
    elif severity == Severity.MINOR:
        parts.append("[yellow]\u26a0 Minor gaps[/yellow]")
        parts.append("")

    for field_key in FIELDS:
        field_label = FIELD_LABELS.get(field_key, field_key)
        value = response.get(field_key, "N/A")

        parts.append(f"[bold cyan]{field_label}[/bold cyan]")

        if field_key == "warningSigns" and isinstance(value, list):
            for sign in value:
                parts.append(f"  [yellow]\u2022[/yellow] {sign}")
        elif value is None:
            parts.append("  [dim]None[/dim]")
        else:
            # Wrap long text for readability
            parts.append(f"  {value}")

        parts.append("")  # blank line between fields

    return Panel(
        "\n".join(parts).rstrip(),
        title=f"[bold]{label}[/bold]",
        expand=True,
        padding=(1, 2),
    )


def display_comparison(
    result_a: RunResult,
    result_b: RunResult,
    round_num: int,
    total_rounds: int,
) -> None:
    """Display two results for blind comparison (model names hidden)."""
    console.clear()
    console.print(
        f"\n[bold]Round {round_num}/{total_rounds}[/bold]  |  "
        f"Language: [cyan]{result_a.language}[/cyan]\n"
    )

    panel_a = format_response_panel(result_a.response, "Response A", result_a.severity)
    panel_b = format_response_panel(result_b.response, "Response B", result_b.severity)

    if console.width >= 120:
        console.print(Columns([panel_a, panel_b], equal=True, expand=True))
    else:
        console.print(panel_a)
        console.print()
        console.print(panel_b)

    console.print(
        "\n[bold]Which response is better?[/bold]\n"
        "  [green]\\[A][/green] Response A  |  "
        "[green]\\[B][/green] Response B  |  "
        "[yellow]\\[T]ie[/yellow]  |  "
        "[dim]\\[S]kip[/dim]  |  "
        "[red]\\[Q]uit[/red]\n"
    )


def get_user_choice() -> str:
    """Get user's comparison choice."""
    while True:
        try:
            choice = input("Your choice: ").strip().upper()
        except (EOFError, KeyboardInterrupt):
            return "Q"
        if choice in ("A", "B", "T", "S", "Q"):
            return choice
        console.print("[red]Invalid choice. Enter A, B, T, S, or Q.[/red]")


def display_rankings(
    elo: dict[str, EloState],
    results: dict[tuple[str, str], list[RunResult]],
    head_to_head: dict[tuple[str, str], dict[str, int]],
) -> None:
    """Display final ELO rankings, head-to-head, and performance stats."""
    console.print("\n[bold]" + "\u2550" * 40 + " Final Rankings " + "\u2550" * 40 + "[/bold]\n")

    # Sort by ELO descending
    ranked = sorted(elo.items(), key=lambda x: x[1].rating, reverse=True)

    if not ranked:
        console.print("[yellow]No comparisons recorded yet.[/yellow]")
        return

    # --- Main ranking table ---
    table = Table(title="ELO Rankings", show_lines=True)
    table.add_column("#", style="bold", width=3, justify="center")
    table.add_column("Model", style="cyan")
    table.add_column("ELO", style="bold green", justify="right")
    table.add_column("W", justify="right")
    table.add_column("L", justify="right")
    table.add_column("T", justify="right")
    table.add_column("Win%", justify="right")
    table.add_column("Avg Time (s)", justify="right")
    table.add_column("Avg tok/s", justify="right")

    for rank, (model, state) in enumerate(ranked, 1):
        # Aggregate performance stats across all languages
        model_runs: list[RunResult] = []
        for (m, _lang), runs in results.items():
            if m == model:
                model_runs.extend(runs)

        avg_time = (
            sum(r.wall_clock_s for r in model_runs) / len(model_runs)
            if model_runs
            else 0
        )
        avg_toks = (
            sum(r.tokens_per_second for r in model_runs) / len(model_runs)
            if model_runs
            else 0
        )

        table.add_row(
            str(rank),
            model,
            f"{state.rating:.0f}",
            str(state.wins),
            str(state.losses),
            str(state.ties),
            f"{state.win_rate:.0f}%",
            f"{avg_time:.1f}",
            f"{avg_toks:.1f}",
        )

    console.print(table)

    # --- Head-to-head matrix ---
    if len(ranked) > 1:
        console.print("\n[bold]Head-to-Head (wins)[/bold]\n")

        h2h_table = Table(show_lines=True)
        h2h_table.add_column("", style="cyan bold")
        models = [m for m, _ in ranked]
        for m in models:
            h2h_table.add_column(m, justify="center")

        for m1 in models:
            row: list[str] = []
            for m2 in models:
                if m1 == m2:
                    row.append("[dim]-[/dim]")
                else:
                    pair = tuple(sorted([m1, m2]))
                    h2h = head_to_head.get(pair, {})
                    wins = h2h.get(m1, 0)
                    row.append(str(wins))
            h2h_table.add_row(m1, *row)

        console.print(h2h_table)


# --- Main ---


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Blind A/B comparison for LLM consultation summary benchmarks"
    )
    parser.add_argument(
        "--results-dir",
        default="./results",
        help="Directory with benchmark results (default: ./results relative to script)",
    )
    parser.add_argument(
        "--rounds-per-pair",
        type=int,
        default=3,
        help="Comparison rounds per model pair per language (default: 3)",
    )
    parser.add_argument(
        "--lang",
        default="all",
        help="Filter by language: EN, ES, or all (default: all)",
    )
    args = parser.parse_args()

    # Resolve results dir relative to script location
    results_dir = Path(args.results_dir)
    if not results_dir.is_absolute():
        results_dir = Path(__file__).parent / results_dir

    jsonl_path = results_dir.parent / "comparisons.jsonl"

    # --- Load results ---
    results = load_results(results_dir, args.lang)

    if not results:
        console.print("[red]No valid results found.[/red]")
        sys.exit(1)

    models = sorted(set(m for m, _ in results.keys()))
    console.print(f"\n[bold]Loaded {len(results)} model/language group(s):[/bold]")
    for (model, lang), runs in sorted(results.items()):
        degraded = sum(1 for r in runs if r.severity != Severity.OK)
        suffix = f" ({degraded} degraded)" if degraded else ""
        console.print(f"  {model} [{lang}]: {len(runs)} run(s){suffix}")

    if len(models) < 2:
        console.print(
            "\n[red]Need at least 2 models to compare. "
            "Run generate.sh with different models first.[/red]"
        )
        sys.exit(1)

    # --- Resume state from existing comparisons ---
    existing = load_existing_comparisons(jsonl_path)
    elo = rebuild_elo(existing)
    completed = count_completed_pairs(existing)

    # Rebuild head-to-head from existing
    head_to_head: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    for comp in existing:
        choice = comp.get("choice", "skip")
        if choice in ("S", "skip"):
            continue
        m_a, m_b = comp["model_a"], comp["model_b"]
        pair = tuple(sorted([m_a, m_b]))
        if choice == "A":
            head_to_head[pair][m_a] += 1
        elif choice == "B":
            head_to_head[pair][m_b] += 1

    # Ensure all loaded models have ELO state
    for model in models:
        if model not in elo:
            elo[model] = EloState()

    # --- Generate comparison queue ---
    queue = generate_comparison_queue(results, args.rounds_per_pair, completed)

    if not queue:
        console.print("\n[yellow]All comparisons already completed.[/yellow]")
        display_rankings(elo, results, head_to_head)
        return

    console.print(f"\n[bold]{len(queue)} comparison(s) remaining.[/bold]")
    if existing:
        console.print(
            f"[dim]Resuming from {len(existing)} previous comparison(s).[/dim]"
        )
    console.print()

    try:
        input("Press Enter to start comparisons...")
    except (EOFError, KeyboardInterrupt):
        return

    # --- Run comparisons ---
    for idx, task in enumerate(queue):
        runs_a = results.get((task.model_a, task.language), [])
        runs_b = results.get((task.model_b, task.language), [])

        if not runs_a or not runs_b:
            continue

        result_a = random.choice(runs_a)
        result_b = random.choice(runs_b)

        display_comparison(result_a, result_b, idx + 1, len(queue))
        choice = get_user_choice()

        if choice == "Q":
            console.print("\n[yellow]Quitting early...[/yellow]")
            break

        # Update ELO and head-to-head
        pair = tuple(sorted([task.model_a, task.model_b]))

        if choice == "A":
            update_elo(elo[task.model_a], elo[task.model_b], winner="a")
            head_to_head[pair][task.model_a] += 1
        elif choice == "B":
            update_elo(elo[task.model_a], elo[task.model_b], winner="b")
            head_to_head[pair][task.model_b] += 1
        elif choice == "T":
            update_elo(elo[task.model_a], elo[task.model_b], winner="tie")
        # S (skip): no ELO update

        # Persist comparison to JSONL
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "language": task.language,
            "model_a": task.model_a,
            "model_b": task.model_b,
            "run_a": result_a.run,
            "run_b": result_b.run,
            "choice": choice,
        }
        with open(jsonl_path, "a") as f:
            f.write(json.dumps(record) + "\n")

    # --- Display final rankings ---
    display_rankings(elo, results, head_to_head)


if __name__ == "__main__":
    main()
