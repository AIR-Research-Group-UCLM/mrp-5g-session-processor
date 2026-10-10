#!/usr/bin/env python3
"""Offline evaluation of processed sessions exported with export-sessions.mjs.

Subcommands:

  accuracy   Transcription and speaker metrics against a reference transcript
             (the simulator script for synthetic sessions, or a reference built
             with cha_to_reference.py for real recordings).
  grounding  Lexical grounding of the extracted clinical indicators and
             keywords in the transcript (deterministic hallucination proxy).
  stability  Run-to-run agreement between sessions processed from the same
             recording.

Usage:
    python evaluate.py accuracy  export.json [--reference ID=ref.json ...] [--csv out.csv]
    python evaluate.py grounding export.json [--csv out.csv]
    python evaluate.py stability export.json --group NAME=ID1,ID2,ID3 [...] [--csv out.csv]

Only the Python standard library is required. See README.md for the exact
definition of every metric.
"""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from statistics import mean

# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------


def app_normalize(text: str) -> list[str]:
    """Exact port of normalizeText() in packages/backend/src/services/accuracy.service.ts."""
    kept = "".join(ch for ch in text.lower() if unicodedata.category(ch)[0] in "LN" or ch.isspace())
    return kept.split()


FILLERS = {
    "en": {"uh", "um", "uhm", "umm", "hmm", "hm", "mm", "mhm", "mmhm", "uhhuh", "uhuh", "er", "erm", "ah", "eh"},
    "es": {"eh", "em", "ehm", "mm", "mmm", "hmm", "hm", "mhm", "este"},
}

_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen " \
        "sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _en_int(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else " " + _ONES[n % 10])
    if n < 1000:
        return _ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + _en_int(n % 100))
    if n < 1_000_000:
        return _en_int(n // 1000) + " thousand" + ("" if n % 1000 == 0 else " " + _en_int(n % 1000))
    return str(n)


def _en_numbers(text: str) -> str:
    def repl(m: re.Match) -> str:
        whole, frac = m.group(1).replace(",", ""), m.group(2)
        words = _en_int(int(whole))
        if frac:
            words += " point " + " ".join(_ONES[int(d)] for d in frac)
        return f" {words} "

    text = re.sub(r"(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?", repl, text)
    return text.replace("%", " percent ")


def eval_normalize(text: str, lang: str) -> list[str]:
    """Normalisation used by the evaluation metrics (WER, alignment).

    NFKC + lowercase, English numerals spelled out, hyphens/slashes split,
    remaining punctuation removed, diacritics kept, fillers dropped.
    """
    text = unicodedata.normalize("NFKC", text).lower()
    if lang == "en":
        text = _en_numbers(text)
    text = re.sub(r"[-‐‑–—/]", " ", text)
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] in "LN" or ch.isspace())
    fillers = FILLERS.get(lang, set())
    return [w for w in text.split() if w not in fillers]


def strip_accents(text: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", text) if unicodedata.category(ch) != "Mn")


# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------


def levenshtein(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        ai = a[i - 1]
        for j in range(1, len(b) + 1):
            cur[j] = prev[j - 1] if ai == b[j - 1] else 1 + min(prev[j], cur[j - 1], prev[j - 1])
        prev = cur
    return prev[-1]


def align(ref: list[str], hyp: list[str]) -> list[tuple[int | None, int | None]]:
    """Minimum-edit-distance alignment (unit costs) with backtrace.

    Returns (ref_index, hyp_index) pairs; None marks a deletion/insertion.
    Ties are broken towards diagonal moves (match/substitution).
    """
    n, m = len(ref), len(hyp)
    back = [bytearray(m + 1) for _ in range(n + 1)]  # 0 diag, 1 up (deletion), 2 left (insertion)
    prev = list(range(m + 1))
    for j in range(1, m + 1):
        back[0][j] = 2
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        back[i][0] = 1
        ri, bi = ref[i - 1], back[i]
        for j in range(1, m + 1):
            diag = prev[j - 1] + (ri != hyp[j - 1])
            up = prev[j] + 1
            left = cur[j - 1] + 1
            if diag <= up and diag <= left:
                cur[j] = diag
            elif up <= left:
                cur[j], bi[j] = up, 1
            else:
                cur[j], bi[j] = left, 2
        prev = cur
    pairs, i, j = [], n, m
    while i > 0 or j > 0:
        move = back[i][j]
        if move == 0:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif move == 1:
            pairs.append((i - 1, None))
            i -= 1
        else:
            pairs.append((None, j - 1))
            j -= 1
    pairs.reverse()
    return pairs


def edit_counts(ref: list[str], hyp: list[str], pairs) -> dict[str, int]:
    c = Counter()
    for i, j in pairs:
        if i is None:
            c["ins"] += 1
        elif j is None:
            c["del"] += 1
        elif ref[i] == hyp[j]:
            c["hit"] += 1
        else:
            c["sub"] += 1
    return c


# ---------------------------------------------------------------------------
# Accuracy
# ---------------------------------------------------------------------------

CLINICIAN = {"DOCTOR", "SPECIALIST"}


def coarse(role: str | None) -> str | None:
    if role is None:
        return None
    return "CLINICIAN" if role in CLINICIAN else role


def labelled_words(items, text_key: str, speaker_key: str, lang: str) -> tuple[list[str], list[str]]:
    words, labels = [], []
    for it in items:
        toks = eval_normalize(it.get(text_key) or "", lang)
        words += toks
        labels += [it.get(speaker_key)] * len(toks)
    return words, labels


def app_metrics(ref_segments, sections) -> dict:
    """Exact port of calculateAccuracy() in accuracy.service.ts (WER after segmentation, word-share speaker score)."""
    ref_words = app_normalize(" ".join(s["text"] for s in ref_segments))
    hyp_words = app_normalize(" ".join(s["content"] for s in sections))
    wer = (levenshtein(ref_words, hyp_words) / len(ref_words)) if ref_words else float(bool(hyp_words))

    orig, trans = Counter(), Counter()
    for s in ref_segments:
        orig[s["speaker"]] += len(app_normalize(s["text"]))
    for s in sections:
        if s.get("speaker"):
            trans[s["speaker"]] += len(app_normalize(s["content"]))
    to, tt = sum(orig.values()), sum(trans.values())
    per_role, overall = {}, 0.0
    for sp, n in orig.items():
        exp = n / to if to else 0
        act = trans.get(sp, 0) / tt if tt else 0
        acc = max(0.0, (1 - abs(exp - act) / max(exp, 0.01)) * 100)
        per_role[sp] = round(acc, 1)
        overall += acc * exp
    return {
        "app_text_similarity": round(max(0.0, (1 - wer) * 100), 1),
        "app_wer": round(wer * 100, 1),
        "app_speaker_overall": round(overall, 1),
        **{f"app_speaker_{sp.lower()}": v for sp, v in per_role.items()},
    }


def diarisation_accuracy(ref_labels, asr_labels, pairs) -> tuple[float, dict]:
    """Share of aligned word pairs whose anonymous ASR label maps to the reference speaker
    under the best one-to-one mapping between ASR labels and reference speakers."""
    joint = Counter((ref_labels[i], asr_labels[j]) for i, j in pairs if i is not None and j is not None)
    total = sum(joint.values())
    refs = sorted({r for r, _ in joint})
    hyps = sorted({h for _, h in joint})
    best, best_map = 0, {}
    # Brute force is fine: a consultation has a handful of speakers.
    small, large, flip = (hyps, refs, False) if len(hyps) <= len(refs) else (refs, hyps, True)
    for perm in itertools.permutations(large, len(small)):
        mapping = {h: r for h, r in zip(small, perm)} if not flip else {h: r for r, h in zip(small, perm)}
        score = sum(joint[(r, h)] for h, r in mapping.items())
        if score > best:
            best, best_map = score, mapping
    return (100 * best / total if total else 0.0), best_map


def role_accuracy(ref_labels, hyp_labels, pairs, mapper=lambda r: r) -> tuple[float, dict]:
    aligned = [(mapper(ref_labels[i]), mapper(hyp_labels[j])) for i, j in pairs if i is not None and j is not None]
    if not aligned:
        return 0.0, {}
    per = defaultdict(lambda: [0, 0])
    for r, h in aligned:
        per[r][1] += 1
        per[r][0] += r == h
    overall = 100 * sum(c for c, _ in per.values()) / len(aligned)
    return overall, {r: 100 * c / n for r, (c, n) in per.items()}


def parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.replace("Z", "").replace("T", " ")
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def seconds(start: str | None, end: str | None) -> float:
    t0, t1 = parse_ts(start), parse_ts(end)
    return (t1 - t0).total_seconds() if t0 and t1 else 0.0


def timing_and_cost(s: dict) -> dict:
    """Stage durations and costs, summed as the web UI does (queue waiting time excluded)."""
    out = {}
    jobs = {j["jobType"]: j for j in s["jobs"]}
    for key, label in [("transcribe", "transcription"), ("segment", "segmentation"), ("generate-metadata", "metadata")]:
        if key in jobs:
            out[f"{label}_s"] = round(seconds(jobs[key]["startedAt"], jobs[key]["completedAt"]), 1)
            out[f"{label}_cost_usd"] = jobs[key]["costUsd"]
    proc_s = sum(seconds(j["startedAt"], j["completedAt"]) for j in s["jobs"])
    proc_cost = sum(j["costUsd"] or 0 for j in s["jobs"])
    out["processing_s"] = round(proc_s, 1)
    out["processing_cost_usd"] = round(proc_cost, 4)
    sim = s.get("simulation")
    if sim:
        sim_s = sum(seconds(sim[f"{k}StartedAt"], sim[f"{k}CompletedAt"]) for k in ("conversation", "audio", "concatenation"))
        out["simulation_s"] = round(sim_s, 1)
        out["simulation_cost_usd"] = sim["totalCostUsd"]
        out["total_s"] = round(sim_s + proc_s, 1)
        out["total_cost_usd"] = round((sim["totalCostUsd"] or 0) + proc_cost, 4)
    return out


def cmd_accuracy(sessions, args) -> list[dict]:
    external = {}
    for spec in args.reference or []:
        sid, path = spec.split("=", 1)
        with open(path, encoding="utf-8") as fh:
            external[sid] = json.load(fh)
    rows = []
    for s in sessions:
        ref = external.get(s["id"]) or s.get("reference")
        if not ref:
            print(f"skip {s['title']}: no reference transcript", file=sys.stderr)
            continue
        lang = s["language"]
        ref_segs = ref["segments"]
        sections = s["sections"]
        asr_segs = sorted(s["asr"]["segments"], key=lambda x: (x["start"], x["end"]))

        ref_w, ref_l = labelled_words(ref_segs, "text", "speaker", lang)
        asr_w, asr_l = labelled_words(asr_segs, "text", "speaker", lang)
        hyp_w, hyp_l = labelled_words(sections, "content", "speaker", lang)

        asr_pairs = align(ref_w, asr_w)
        hyp_pairs = align(ref_w, hyp_w)
        ec_asr = edit_counts(ref_w, asr_w, asr_pairs)
        ec_hyp = edit_counts(ref_w, hyp_w, hyp_pairs)

        diar, mapping = diarisation_accuracy(ref_l, asr_l, asr_pairs)
        role_fine, per_fine = role_accuracy(ref_l, hyp_l, hyp_pairs)
        role_coarse, per_coarse = role_accuracy(ref_l, hyp_l, hyp_pairs, coarse)

        row = {
            "id": s["id"],
            "title": s["title"],
            "language": lang,
            "kind": "synthetic" if s.get("reference") else "real",
            "duration_s": s["durationSeconds"],
            "ref_words": len(ref_w),
            "asr_words": len(asr_w),
            "pipeline_words": len(hyp_w),
            "ref_speakers": len(set(ref_l)),
            "asr_speakers": len(set(asr_l)),
            "wer_asr": round(100 * (ec_asr["sub"] + ec_asr["del"] + ec_asr["ins"]) / len(ref_w), 2),
            "wer_asr_sub": ec_asr["sub"], "wer_asr_del": ec_asr["del"], "wer_asr_ins": ec_asr["ins"],
            "wer_pipeline": round(100 * (ec_hyp["sub"] + ec_hyp["del"] + ec_hyp["ins"]) / len(ref_w), 2),
            "diarisation_acc": round(diar, 2),
            "diarisation_mapping": json.dumps(mapping, sort_keys=True),
            "role_acc": round(role_fine, 2),
            "role_acc_coarse": round(role_coarse, 2),
            **{f"role_acc_{r.lower()}": round(v, 2) for r, v in sorted(per_fine.items())},
            **{f"role_acc_coarse_{r.lower()}": round(v, 2) for r, v in sorted(per_coarse.items())},
        }
        if s.get("reference"):
            row.update(app_metrics(ref_segs, sections))
        row.update(timing_and_cost(s))
        rows.append(row)
        print(f"{s['title']}: WER_asr={row['wer_asr']} diar={row['diarisation_acc']} role={row['role_acc']}",
              file=sys.stderr)
    return rows


# ---------------------------------------------------------------------------
# Lexical grounding
# ---------------------------------------------------------------------------

STOPWORDS = {
    "en": set("""a an and are as at be been but by can could did do does for from had has have he her his how i if in
        into is it its may might more most must no not of on or our over per should so some such than that the their them
        then there these they this those to under up very was we were what when which while who will with within without
        would you your if as needed patient patients possible likely etc""".split()),
    "es": set("""a al algo algun alguna algunas alguno algunos ante antes como con contra cual cuando de del desde donde
        durante e el ella ellas ellos en entre era es esa esas ese eso esos esta estas este esto estos fue ha han hasta
        la las le les lo los mas me mi muy no nos o otra otro para pero poco por que se segun ser si sin sobre su sus
        tambien te tiene tu un una uno unos y ya caso necesario paciente posible probable etc""".split()),
}

GROUNDED_FIELDS = {
    "diagnosticHypothesis": lambda ci: [d.get("condition", "") for d in ci.get("diagnosticHypothesis") or []],
    "requestedTests": lambda ci: ci.get("requestedTests") or [],
    "medication": lambda ci: sum(((ci.get("treatmentPlan") or {}).get(k) or []
                                  for k in ("medicationStarted", "medicationAdjusted", "medicationDiscontinued")), []),
    "nonPharmacologicalMeasures": lambda ci: (ci.get("treatmentPlan") or {}).get("nonPharmacologicalMeasures") or [],
    "warningSigns": lambda ci: ci.get("warningSigns") or [],
    "patientEducation": lambda ci: ci.get("patientEducation") or [],
}

PREFIX = 5        # tokens sharing a 5-character prefix are considered the same lemma
THRESHOLD = 0.5   # an item is grounded when at least half of its content tokens occur in the transcript


def content_tokens(text: str, lang: str) -> list[str]:
    toks = eval_normalize(strip_accents(text), lang)
    stop = {strip_accents(w) for w in STOPWORDS.get(lang, set())}
    return [t for t in toks if len(t) >= 3 and t not in stop and not t.isdigit()]


def grounding_score(item: str, vocab: set[str], prefixes: set[str], lang: str) -> float | None:
    toks = content_tokens(item, lang)
    if not toks:
        return None
    hit = sum(1 for t in toks if t in vocab or (len(t) >= PREFIX and t[:PREFIX] in prefixes))
    return hit / len(toks)


def cmd_grounding(sessions, _args) -> list[dict]:
    rows = []
    for s in sessions:
        lang = s["language"]
        transcript = " ".join(x["content"] for x in s["sections"])
        vocab = set(content_tokens(transcript, lang))
        prefixes = {t[:PREFIX] for t in vocab if len(t) >= PREFIX}
        ci = s.get("clinicalIndicators") or {}
        fields = {name: fn(ci) for name, fn in GROUNDED_FIELDS.items()}
        fields["keywords"] = s.get("keywords") or []
        for name, items in fields.items():
            scores = [grounding_score(it, vocab, prefixes, lang) for it in items]
            scores = [x for x in scores if x is not None]
            rows.append({
                "id": s["id"], "title": s["title"], "language": lang,
                "kind": "synthetic" if s.get("reference") or s.get("simulation") else "real",
                "field": name, "items": len(scores),
                "grounded": sum(1 for x in scores if x >= THRESHOLD),
                "mean_token_coverage": round(mean(scores), 3) if scores else None,
            })
    return rows


# ---------------------------------------------------------------------------
# Run-to-run stability
# ---------------------------------------------------------------------------

CATEGORICAL = {
    "urgencyLevel": lambda ci: ci.get("urgencyLevel"),
    "appointmentPriority": lambda ci: ci.get("appointmentPriority"),
    "problemStatus": lambda ci: ci.get("problemStatus"),
    "followUpType": lambda ci: (ci.get("followUpPlan") or {}).get("followUpType"),
    "responsibleCareLevel": lambda ci: (ci.get("followUpPlan") or {}).get("responsibleCareLevel"),
}
LIST_FIELDS = {k: GROUNDED_FIELDS[k] for k in ("diagnosticHypothesis", "requestedTests", "medication", "warningSigns")}


def label_at(sections, t: float, key: str):
    for s in sections:
        if s["start"] is not None and s["end"] is not None and s["start"] <= t < s["end"]:
            return s[key]
    return None


def timeline_agreement(a, b, duration: float, key: str) -> float | None:
    agree = total = 0
    t = 0.5
    while t < duration:
        la, lb = label_at(a, t, key), label_at(b, t, key)
        if la is not None and lb is not None:
            total += 1
            agree += la == lb
        t += 1.0
    return 100 * agree / total if total else None


def jaccard(x: set, y: set) -> float | None:
    if not x and not y:
        return None
    return len(x & y) / len(x | y)


def cmd_stability(sessions, args) -> list[dict]:
    by_id = {s["id"]: s for s in sessions}
    rows = []
    for spec in args.group:
        name, ids = spec.split("=", 1)
        runs = [by_id[i] for i in ids.split(",")]
        lang = runs[0]["language"]
        duration = max(r["durationSeconds"] or 0 for r in runs)
        pairs = list(itertools.combinations(runs, 2))
        row = {"group": name, "runs": len(runs), "language": lang}

        for field, fn in CATEGORICAL.items():
            vals = [fn(r.get("clinicalIndicators") or {}) for r in runs]
            row[f"{field}_values"] = "|".join(str(v) for v in vals)
            row[f"{field}_agree"] = round(100 * mean(fn(a["clinicalIndicators"] or {}) == fn(b["clinicalIndicators"] or {})
                                                     for a, b in pairs), 1)
        row["categorical_agree_mean"] = round(mean(row[f"{f}_agree"] for f in CATEGORICAL), 1)

        for field, fn in LIST_FIELDS.items():
            sets = [set(content_tokens(" ".join(fn(r.get("clinicalIndicators") or {})), lang)) for r in runs]
            js = [jaccard(x, y) for x, y in itertools.combinations(sets, 2)]
            js = [j for j in js if j is not None]
            row[f"{field}_jaccard"] = round(mean(js), 3) if js else None
        kw = [set(content_tokens(" ".join(r.get("keywords") or []), lang)) for r in runs]
        row["keywords_jaccard"] = round(mean(j for j in (jaccard(x, y) for x, y in itertools.combinations(kw, 2))
                                             if j is not None), 3)

        for key, col in (("sectionType", "section_timeline_agree"), ("speaker", "role_timeline_agree")):
            vals = [timeline_agreement(a["sections"], b["sections"], duration, key) for a, b in pairs]
            vals = [v for v in vals if v is not None]
            row[col] = round(mean(vals), 1) if vals else None
        asr_words = [eval_normalize(r["asr"]["text"], lang) for r in runs]
        row["asr_pairwise_wer"] = round(mean(100 * levenshtein(x, y) / len(x)
                                             for x, y in itertools.combinations(asr_words, 2)), 2)
        rows.append(row)
        print(f"{name}: categorical={row['categorical_agree_mean']} sections={row['section_timeline_agree']} "
              f"roles={row['role_timeline_agree']}", file=sys.stderr)
    return rows


# ---------------------------------------------------------------------------


def write_csv(rows: list[dict], path: str | None) -> None:
    if not rows:
        return
    keys = list(dict.fromkeys(k for r in rows for k in r))
    out = open(path, "w", newline="", encoding="utf-8") if path else sys.stdout
    w = csv.DictWriter(out, fieldnames=keys)
    w.writeheader()
    w.writerows(rows)
    if path:
        out.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("accuracy", "grounding", "stability"):
        p = sub.add_parser(name)
        p.add_argument("export", help="JSON produced by export-sessions.mjs")
        p.add_argument("--csv", help="Output CSV (default: stdout)")
        if name == "accuracy":
            p.add_argument("--reference", nargs="+", metavar="ID=FILE",
                           help="External reference transcript for a non-simulated session")
        if name == "stability":
            p.add_argument("--group", nargs="+", required=True, metavar="NAME=ID1,ID2,...",
                           help="Sessions processed from the same recording")
    args = ap.parse_args()
    with open(args.export, encoding="utf-8") as fh:
        sessions = json.load(fh)
    rows = {"accuracy": cmd_accuracy, "grounding": cmd_grounding, "stability": cmd_stability}[args.cmd](sessions, args)
    write_csv(rows, args.csv)


if __name__ == "__main__":
    main()
