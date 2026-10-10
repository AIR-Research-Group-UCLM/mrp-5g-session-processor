# Evaluation scripts

Offline tools used to evaluate processed sessions: transcription fidelity, speaker diarisation, clinical role attribution, lexical grounding of the extracted clinical indicators, and run-to-run stability. They do not modify the application; they read its database and object storage and compute metrics on a local copy.

Only the Python standard library is needed for the analysis scripts. The exporter runs inside the backend container, which already has the database, the S3 credentials and the backend dependencies.

## Workflow

### 1. Export the sessions

```bash
docker exec -i -e SESSION_IDS="<id1> <id2> ..." mrp-app \
  node --input-type=module - < scripts/evaluation/export-sessions.mjs > export.json
```

The export contains, for every session, the processed case record (speech turns, section summaries, clinical indicators, session metadata), the per-stage processing records (duration, tokens, cost), the simulation record if any, the raw diarised ASR output stored in S3 (`*_transcript.json`) and, for simulated sessions, the simulator script (`simulated_transcript.json`), which is the reference transcript. The SQLite database is opened read-only.

### 2. Build reference transcripts for real recordings (optional)

Real recordings need an external, human-made reference. `cha_to_reference.py` converts a time-aligned CHAT transcript (e.g. from TalkBank or the Santa Barbara Corpus) and maps each CHAT speaker code to a clinical role:

```bash
python cha_to_reference.py SBC046.cha --roles REED=DOCTOR DARR=PATIENT SALL=OTHER > SBC046.ref.json
```

Each CHAT time bullet becomes one reference segment. Conversation-analysis markup is removed (events such as `&=laugh`, pauses, overlap brackets, comments, lengthening colons, glottal stops, cut-off fragments, unintelligible material and terminators), and tiers not listed in `--roles` (e.g. `ENV`) are dropped.

### 3. Compute the metrics

```bash
python evaluate.py accuracy  export.json --reference <id>=SBC046.ref.json --csv accuracy.csv
python evaluate.py grounding export.json --csv grounding.csv
python evaluate.py stability export.json --group knee=<id1>,<id2>,<id3> --csv stability.csv
```

## Metric definitions

### Text normalisation

Two normalisations are used.

- **Application normalisation**, an exact port of `normalizeText()` in `packages/backend/src/services/accuracy.service.ts`: lowercase, remove every character that is not a Unicode letter, digit or whitespace, and split on whitespace.
- **Evaluation normalisation**, used by all the metrics introduced here: NFKC and lowercase; in English, numerals are spelled out (`18` → `eighteen`, `0.1` → `zero point one`, `%` → `percent`); hyphens and slashes become spaces; remaining punctuation is removed (diacritics are kept); and conversational fillers are dropped (`uh`, `um`, `hmm`, `mhm`, … in English; `eh`, `em`, `mm`, … in Spanish). This follows common ASR-evaluation practice, so that spelling conventions of the reference do not count as recognition errors.

### Accuracy (`evaluate.py accuracy`)

All alignments are minimum-edit-distance alignments between word sequences with unit costs for substitutions, deletions and insertions. Backtrace ties go to the diagonal (match/substitution).

| Column | Definition |
|---|---|
| `app_text_similarity`, `app_wer` | Metrics reported by the application (`GET /api/sessions/:id/accuracy`), reproduced exactly. WER = word-level Levenshtein distance / reference words, with application normalisation, between the concatenated simulator script and the concatenated speech turns *after* LLM segmentation. Text similarity = max(0, 1 − WER) × 100. Only available for simulated sessions. |
| `app_speaker_overall`, `app_speaker_<role>` | Word-share agreement reported by the application, reproduced exactly. For each reference role r: accuracy_r = max(0, 1 − \|p_ref(r) − p_hyp(r)\| / max(p_ref(r), 0.01)) × 100, where p(r) is the share of words attributed to r; the overall value is the mean of accuracy_r weighted by p_ref(r). It compares word distributions and does not check individual turns. |
| `wer_asr` (+ `_sub`, `_del`, `_ins`) | WER of the **raw diarised ASR output** (segments sorted by start time) against the reference, with evaluation normalisation. |
| `wer_pipeline` | Same, but on the speech turns after LLM segmentation (what the user sees). |
| `diarisation_acc` | Each aligned pair (match or substitution) between reference and raw ASR words carries a reference speaker and an anonymous ASR label (A, B, C…). The best one-to-one mapping between ASR labels and reference speakers is found exhaustively. The score is the percentage of aligned pairs whose ASR label maps to the reference speaker. `diarisation_mapping` reports the mapping. |
| `role_acc`, `role_acc_<role>` | Each aligned pair between reference and pipeline words carries the reference role and the clinical role assigned by the segmentation stage (DOCTOR, PATIENT, SPECIALIST, OTHER). The score is the percentage of aligned pairs where both roles agree. The per-role value is the recall of that reference role. |
| `role_acc_coarse`, `role_acc_coarse_<role>` | Same, after merging DOCTOR and SPECIALIST into CLINICIAN. Used for recordings with a single clinician (e.g. a patient and one professional). |
| `transcription_s`, `segmentation_s`, `metadata_s`, `processing_s`, `simulation_s`, `total_s` and the `*_cost_usd` columns | Stage durations and costs, summed as the web UI does: queue waiting time is excluded, and the simulation time is the sum of dialogue generation, speech synthesis and concatenation. |

### Lexical grounding (`evaluate.py grounding`)

A deterministic proxy for unsupported (hallucinated) extractions, which needs no reference and no LLM judge. For each extracted item (diagnostic hypotheses, requested tests, medications started/adjusted/discontinued, non-pharmacological measures, warning signs, patient education, keywords):

1. Its content tokens are taken: evaluation normalisation, accents stripped, a small English/Spanish stop-word list removed, tokens shorter than three characters and pure numbers dropped.
2. A token is supported when it occurs in the transcript the extraction stage received (the speech turns), either exactly or with the same first five characters (a light stemming that absorbs plural, gender and inflection).
3. The item is **grounded** when at least 50% of its content tokens are supported.

The output reports, per session and field, the number of items, the number of grounded items and the mean token coverage. This is a lexical measure. Faithful paraphrases that use different words count as ungrounded, which makes it conservative. An unsupported claim built from words that do appear in the transcript counts as grounded. It is therefore a screening indicator, not a substitute for expert review.

### Run-to-run stability (`evaluate.py stability`)

Each group lists sessions processed independently from the same recording (e.g. the same audio uploaded several times). Over all pairs of runs:

| Column | Definition |
|---|---|
| `<field>_agree` | Percentage of run pairs with an identical value for the categorical indicators `urgencyLevel`, `appointmentPriority`, `problemStatus`, `followUpType` and `responsibleCareLevel`. `categorical_agree_mean` is their mean. |
| `<field>_jaccard` | Mean pairwise Jaccard index between the sets of content tokens of the list-valued indicators (diagnostic hypotheses, requested tests, medications, warning signs) and of the keywords. |
| `section_timeline_agree`, `role_timeline_agree` | The recording is sampled every second (t = 0.5 s, 1.5 s, …). At each instant covered by a speech turn in both runs, the clinical section (resp. role) is compared. The score is the percentage of agreeing instants. |
| `asr_pairwise_wer` | Mean pairwise WER between the raw ASR texts of the runs (ASR non-determinism). |
