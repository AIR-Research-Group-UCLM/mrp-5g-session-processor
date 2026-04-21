#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# generate.sh — T3 benchmark using OpenAI Chat Completions API
#
# Mirrors scripts/benchmark/generate.sh but calls the OpenAI
# API instead of Ollama. Same prompts, same JSON schema, same
# temperature (0.3). Only the model changes — the architecture
# is identical so the comparison isolates "local vs. cloud".
#
# Usage:
#   ./generate.sh --lang EN [--model gpt-4o] [--runs 5]
#
# Requires OPENAI_API_KEY in the environment, or in
# packages/backend/.env relative to the repo root.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Defaults
OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
RUNS=5
MODEL="gpt-4o"
LANG=""

usage() {
  cat <<EOF
Usage: $(basename "$0") --lang <EN|ES> [OPTIONS]

Options:
  --lang            Language code (EN or ES) [required]
  --model           OpenAI model name (default: gpt-4o)
  --runs            Number of runs (default: 5)
  --openai-url      OpenAI API base URL (default: https://api.openai.com/v1)
  -h, --help        Show this help
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)       MODEL="$2"; shift 2 ;;
    --lang)        LANG=$(echo "$2" | tr '[:lower:]' '[:upper:]'); shift 2 ;;
    --runs)        RUNS="$2"; shift 2 ;;
    --openai-url)  OPENAI_BASE_URL="$2"; shift 2 ;;
    -h|--help)     usage 0 ;;
    *)             echo "Unknown option: $1"; usage 1 ;;
  esac
done

if [[ -z "$LANG" ]]; then
  echo "ERROR: --lang is required."
  usage 1
fi

# --- API key discovery ---

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  BACKEND_ENV="${REPO_ROOT}/packages/backend/.env"
  if [[ -f "$BACKEND_ENV" ]]; then
    # Extract OPENAI_API_KEY=... without sourcing (the .env may contain unquoted # or $)
    OPENAI_API_KEY=$(grep -E '^OPENAI_API_KEY=' "$BACKEND_ENV" | head -1 | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/')
    export OPENAI_API_KEY
  fi
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY not set and not found in packages/backend/.env"
  exit 1
fi

# --- Helpers ---

fix_num() {
  local n="$1"
  case "$n" in
    .*) echo "0$n" ;;
    -.*) echo "-0${n#-}" ;;
    "") echo "0" ;;
    *) echo "$n" ;;
  esac
}

calc() {
  fix_num "$(echo "scale=2; $1" | bc 2>/dev/null || echo "0")"
}

# Same parse_response as the parent generate.sh — strategies in order:
# 1. direct jq parse,
# 2. strip <think> + ``` fences, parse,
# 3. take first { to last }.
parse_response() {
  local content="$1"
  local result

  if result=$(printf '%s' "$content" | jq -e '.' 2>/dev/null); then
    printf '%s' "$result"
    return 0
  fi

  local cleaned
  cleaned=$(printf '%s' "$content" \
    | sed '/<think>/,/<\/think>/d' \
    | sed '/^```\(json\)\{0,1\}[[:space:]]*$/d')
  if result=$(printf '%s' "$cleaned" | jq -e '.' 2>/dev/null); then
    printf '%s' "$result"
    return 0
  fi

  local first_line last_line substr
  first_line=$(printf '%s\n' "$content" | grep -n '{' | head -1 | cut -d: -f1)
  last_line=$(printf '%s\n' "$content" | grep -n '}' | tail -1 | cut -d: -f1)
  if [[ -n "${first_line:-}" && -n "${last_line:-}" && "$first_line" -le "$last_line" ]]; then
    substr=$(printf '%s\n' "$content" | sed -n "${first_line},${last_line}p")
    if result=$(printf '%s' "$substr" | jq -e '.' 2>/dev/null); then
      printf '%s' "$result"
      return 0
    fi
  fi

  return 1
}

# --- Pre-flight ---

echo "=== Pre-flight checks ==="

for cmd in curl jq bc; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: Required tool '$cmd' not found in PATH"
    exit 1
  fi
  echo "  [ok] $cmd"
done

SYSTEM_PROMPT_FILE="${SCRIPT_DIR}/${LANG}-system-prompt.txt"
USER_PROMPT_FILE="${SCRIPT_DIR}/${LANG}-user-prompt.txt"

for f in "$SYSTEM_PROMPT_FILE" "$USER_PROMPT_FILE"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: Prompt file not found: $f"
    exit 1
  fi
  echo "  [ok] $(basename "$f")"
done

# Cheap reachability check — list models.
if ! curl -sf -H "Authorization: Bearer ${OPENAI_API_KEY}" "${OPENAI_BASE_URL}/models" > /dev/null 2>&1; then
  echo "  [!!] OpenAI API reachability check failed (will still attempt requests)"
else
  echo "  [ok] OpenAI API reachable"
fi

echo ""

# --- Load prompts ---

SYSTEM_PROMPT_JSON=$(jq -Rs '.' < "$SYSTEM_PROMPT_FILE")
USER_PROMPT_JSON=$(jq -Rs '.' < "$USER_PROMPT_FILE")

# --- Output dir ---

MODEL_DIR=$(printf '%s' "$MODEL" | tr ':/' '__')
OUTPUT_DIR="${RESULTS_DIR}/${MODEL_DIR}/${LANG}"
mkdir -p "$OUTPUT_DIR"

echo "=== Benchmark: ${MODEL} | Language: ${LANG} | Runs: ${RUNS} ==="
echo "    Output: ${OUTPUT_DIR}"
echo ""

# --- Main loop ---

TOTAL_WALL=0
TOTAL_EVAL_COUNT=0
VALID_COUNT=0

for ((i = 1; i <= RUNS; i++)); do
  printf "[%d/%d] Generating... " "$i" "$RUNS"

  PAYLOAD=$(jq -n \
    --arg model "$MODEL" \
    --argjson system "$SYSTEM_PROMPT_JSON" \
    --argjson user "$USER_PROMPT_JSON" \
    '{
      model: $model,
      messages: [
        { role: "system", content: $system },
        { role: "user", content: $user }
      ],
      temperature: 0.3
    }')

  START_NS=$(date +%s%N)

  RESPONSE=$(curl -sf "${OPENAI_BASE_URL}/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -d "$PAYLOAD" 2>/dev/null) || {
    printf "FAILED (curl error)\n"
    continue
  }

  END_NS=$(date +%s%N)
  WALL_CLOCK=$(calc "($END_NS - $START_NS) / 1000000000")

  RAW_CONTENT=$(printf '%s' "$RESPONSE" | jq -r '.choices[0].message.content // ""')
  EVAL_COUNT=$(printf '%s' "$RESPONSE" | jq -r '.usage.completion_tokens // 0')

  # OpenAI doesn't expose server-side eval duration; approximate with wall-clock.
  EVAL_DURATION_S="$WALL_CLOCK"
  if (( $(echo "$EVAL_DURATION_S > 0" | bc) )); then
    TOKS_PER_SEC=$(calc "$EVAL_COUNT / $EVAL_DURATION_S")
  else
    TOKS_PER_SEC="0"
  fi

  VALID_JSON="false"
  PARSED=""

  if PARSED=$(parse_response "$RAW_CONTENT"); then
    PARSED=$(printf '%s' "$PARSED" | jq '
      def normalize_key:
        gsub("[_-]"; "") | ascii_downcase |
        if . == "whathappened" then "whatHappened"
        elif . == "diagnosis" then "diagnosis"
        elif . == "treatmentplan" then "treatmentPlan"
        elif . == "followup" then "followUp"
        elif . == "warningsigns" then "warningSigns"
        elif . == "additionalnotes" then "additionalNotes"
        else .
        end;
      with_entries(.key |= normalize_key)
    ' 2>/dev/null) || PARSED=""

    if [[ -n "$PARSED" ]]; then
      HAS_FIELDS=$(printf '%s' "$PARSED" | jq \
        'has("whatHappened") and has("diagnosis") and has("treatmentPlan") and has("followUp") and has("warningSigns")' \
        2>/dev/null || echo "false")
      if [[ "$HAS_FIELDS" == "true" ]]; then
        VALID_JSON="true"
        VALID_COUNT=$((VALID_COUNT + 1))
      fi
    fi
  fi

  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  RESP_INPUT="${PARSED:-null}"
  RESULT=$(printf '%s' "$RESP_INPUT" | jq \
    --arg model "$MODEL" \
    --arg language "$LANG" \
    --argjson run "$i" \
    --arg timestamp "$TIMESTAMP" \
    --argjson wall_clock "$WALL_CLOCK" \
    --argjson eval_duration "$EVAL_DURATION_S" \
    --argjson eval_count "$EVAL_COUNT" \
    --argjson tps "$TOKS_PER_SEC" \
    --argjson valid "$VALID_JSON" \
    --arg raw_content "$RAW_CONTENT" \
    '{
      model: $model,
      language: $language,
      run: $run,
      timestamp: $timestamp,
      wall_clock_s: $wall_clock,
      eval_duration_s: $eval_duration,
      eval_count: $eval_count,
      tokens_per_second: $tps,
      valid_json: $valid,
      response: .,
      raw_content: $raw_content
    }')

  RUN_FILE=$(printf "%s/run_%03d.json" "$OUTPUT_DIR" "$i")
  printf '%s\n' "$RESULT" > "$RUN_FILE"

  TOTAL_WALL=$(calc "$TOTAL_WALL + $WALL_CLOCK")
  TOTAL_EVAL_COUNT=$(calc "$TOTAL_EVAL_COUNT + $EVAL_COUNT")

  printf "%ss | %s tok/s | valid: %s\n" "$WALL_CLOCK" "$TOKS_PER_SEC" "$VALID_JSON"
done

# --- Summary ---

echo ""
echo "=== Summary ==="

if [[ "$RUNS" -gt 0 ]]; then
  echo "  Avg wall clock: $(calc "$TOTAL_WALL / $RUNS")s"
fi
echo "  Valid JSON rate: ${VALID_COUNT}/${RUNS}"

if (( $(echo "$TOTAL_WALL > 0" | bc) )); then
  echo "  Avg tok/s:       $(calc "$TOTAL_EVAL_COUNT / $TOTAL_WALL")"
else
  echo "  Avg tok/s:       N/A"
fi

echo "  Results:         ${OUTPUT_DIR}"
