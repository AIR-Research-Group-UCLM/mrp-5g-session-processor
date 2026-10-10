#!/usr/bin/env python3
"""Convert a time-aligned CHAT (.cha) transcript into a reference transcript.

The output has the same shape as the simulator script used as reference for
synthetic sessions, plus timestamps:

    {"segments": [{"speaker": "DOCTOR", "text": "...", "start": 2.589, "end": 4.447}, ...]}

Each CHAT time bullet (``start_end`` in milliseconds) becomes one segment.
Conversation-analysis markup is removed: events (``&=laugh``), pauses
(``(..)``), overlap brackets (``⌈ ⌉ ⌊ ⌋``), comments (``[% ...]``), lengthening
colons, glottal stops, cut-off word fragments (``He-``), unintelligible
material (``xxx``) and utterance terminators. Tiers whose code is not listed
in ``--roles`` (e.g. ``ENV``) are dropped.

Usage:
    python cha_to_reference.py SBC046.cha --roles REED=DOCTOR DARR=PATIENT SALL=OTHER > SBC046.ref.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys

BULLET = re.compile(r"\x15?(\d+)_(\d+)\x15?")


def clean(text: str) -> str:
    text = re.sub(r"\[[^\]]*\]", " ", text)  # [% comment], [//], [/] ...
    text = re.sub(r"[⌈⌉⌊⌋]\d*", "", text)  # overlap markers
    words = []
    for tok in text.split():
        if tok.startswith(("&", "+")):  # events, layered speech, terminators/linkers
            continue
        if re.fullmatch(r"\((\.+|[\d.]+)\)", tok):  # pauses
            continue
        tok = re.sub(r"@\w+", "", tok)  # special form markers (word@l)
        tok = re.sub(r"[:ʔ∙()↑↓→↗↘≈≋°▔▁☺♋∬Ϋ∲§∾↻⁎„‡]", "", tok)
        if not tok or tok in {".", "?", "!", ","} or tok.endswith("-"):
            continue
        if re.fullmatch(r"(xxx|yyy|www)", tok.lower()):
            continue
        words.append(tok)
    return " ".join(words)


def parse(path: str, roles: dict[str, str]) -> list[dict]:
    segments = []
    speaker = None
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if line.startswith("*"):
                code, _, line = line[1:].partition(":")
                speaker = code.strip()
            elif not line.startswith("\t"):
                speaker = None  # header (@) or dependent tier (%)
                continue
            if speaker is None or speaker not in roles:
                continue
            # A line can hold several bullets: text1 b1 text2 b2 ...
            pos = 0
            for m in BULLET.finditer(line):
                text = clean(line[pos:m.start()])
                pos = m.end()
                if text:
                    segments.append({
                        "speaker": roles[speaker],
                        "sourceSpeaker": speaker,
                        "text": text,
                        "start": int(m.group(1)) / 1000,
                        "end": int(m.group(2)) / 1000,
                    })
    segments.sort(key=lambda s: (s["start"], s["end"]))
    return segments


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cha")
    ap.add_argument("--roles", nargs="+", required=True, metavar="CODE=ROLE",
                    help="Map CHAT speaker codes to DOCTOR/PATIENT/SPECIALIST/OTHER")
    args = ap.parse_args()
    roles = dict(r.split("=", 1) for r in args.roles)
    json.dump({"segments": parse(args.cha, roles)}, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
