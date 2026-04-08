#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# generate.sh — Benchmark Ollama models for consultation summary
#
# Usage:
#   ./generate.sh --model qwen3:30b --lang EN [--runs 5] [--ollama-url http://localhost:11434]
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"

# Defaults
OLLAMA_URL="http://localhost:11434"
RUNS=5
MODEL=""
LANG=""

# --- Argument parsing ---

usage() {
  cat <<EOF
Usage: $(basename "$0") --model <model> --lang <EN|ES> [OPTIONS]

Options:
  --model        Ollama model name (e.g., qwen3:30b, llama3.1:8b, gemma3:12b)
  --lang         Language code (EN or ES)
  --runs         Number of runs per model (default: 5)
  --ollama-url   Ollama base URL (default: http://localhost:11434)
  -h, --help     Show this help
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)     MODEL="$2"; shift 2 ;;
    --lang)      LANG=$(echo "$2" | tr '[:lower:]' '[:upper:]'); shift 2 ;;
    --runs)      RUNS="$2"; shift 2 ;;
    --ollama-url) OLLAMA_URL="$2"; shift 2 ;;
    -h|--help)   usage 0 ;;
    *)           echo "Unknown option: $1"; usage 1 ;;
  esac
done

if [[ -z "$MODEL" || -z "$LANG" ]]; then
  echo "ERROR: --model and --lang are required."
  usage 1
fi

# --- Helper functions ---

# bc can output ".75" instead of "0.75" — fix leading dot
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

# Try to extract valid JSON from LLM response text.
# Handles: direct JSON, <think> blocks, markdown fences, embedded JSON.
# Outputs parsed JSON to stdout; returns 0 on success, 1 on failure.
parse_response() {
  local content="$1"
  local result

  # Strategy 1: direct parse
  if result=$(printf '%s' "$content" | jq -e '.' 2>/dev/null); then
    printf '%s' "$result"
    return 0
  fi

  # Strategy 2: strip <think> blocks + markdown fences, then parse
  local cleaned
  cleaned=$(printf '%s' "$content" \
    | sed '/<think>/,/<\/think>/d' \
    | sed '/^```\(json\)\{0,1\}[[:space:]]*$/d')
  if result=$(printf '%s' "$cleaned" | jq -e '.' 2>/dev/null); then
    printf '%s' "$result"
    return 0
  fi

  # Strategy 3: extract substring from first { to last }
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

# --- Pre-flight checks ---

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

if ! curl -sf "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
  echo "ERROR: Ollama not reachable at ${OLLAMA_URL}"
  exit 1
fi
echo "  [ok] Ollama reachable"

if ! curl -sf "${OLLAMA_URL}/api/tags" | jq -e ".models[] | select(.name == \"${MODEL}\")" > /dev/null 2>&1; then
  echo "  [!!] Model '${MODEL}' not found locally — Ollama may pull on first request"
else
  echo "  [ok] Model '${MODEL}' available"
fi

echo ""

# --- Load prompts (JSON-escaped for safe payload construction) ---

SYSTEM_PROMPT_JSON=$(jq -Rs '.' < "$SYSTEM_PROMPT_FILE")
USER_PROMPT_JSON=$(jq -Rs '.' < "$USER_PROMPT_FILE")

# --- Prepare output directory ---

MODEL_DIR=$(printf '%s' "$MODEL" | tr ':/' '__')
OUTPUT_DIR="${RESULTS_DIR}/${MODEL_DIR}/${LANG}"
mkdir -p "$OUTPUT_DIR"

echo "=== Benchmark: ${MODEL} | Language: ${LANG} | Runs: ${RUNS} ==="
echo "    Output: ${OUTPUT_DIR}"
echo ""

# --- Main loop ---

TOTAL_WALL=0
TOTAL_EVAL_DURATION=0
TOTAL_EVAL_COUNT=0
VALID_COUNT=0

for ((i = 1; i <= RUNS; i++)); do
  printf "[%d/%d] Generating... " "$i" "$RUNS"

  # Build request payload entirely with jq (no manual string interpolation)
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
      stream: false,
      think: false,
      options: { temperature: 0.3 }
    }')

  # Time the request (uses nanosecond precision — Linux only)
  START_NS=$(date +%s%N)

  RESPONSE=$(curl -sf "${OLLAMA_URL}/api/chat" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" 2>/dev/null) || {
    printf "FAILED (curl error)\n"
    continue
  }

  END_NS=$(date +%s%N)
  WALL_CLOCK=$(calc "($END_NS - $START_NS) / 1000000000")

  # Extract content and metrics from Ollama response
  RAW_CONTENT=$(printf '%s' "$RESPONSE" | jq -r '.message.content // ""')
  EVAL_COUNT=$(printf '%s' "$RESPONSE" | jq -r '.eval_count // 0')
  EVAL_DURATION_NS=$(printf '%s' "$RESPONSE" | jq -r '.eval_duration // 0')
  EVAL_DURATION_S=$(calc "$EVAL_DURATION_NS / 1000000000")

  if [[ "$EVAL_DURATION_NS" -gt 0 ]]; then
    TOKS_PER_SEC=$(calc "$EVAL_COUNT / ($EVAL_DURATION_NS / 1000000000)")
  else
    TOKS_PER_SEC="0"
  fi

  # Parse and validate response JSON
  VALID_JSON="false"
  PARSED=""

  if PARSED=$(parse_response "$RAW_CONTENT"); then
    # Normalize keys: snake_case/kebab-case/any-case → canonical camelCase
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

  # Build result JSON — pipe parsed response as stdin (.), strings via --arg
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

  # Accumulate totals
  TOTAL_WALL=$(calc "$TOTAL_WALL + $WALL_CLOCK")
  TOTAL_EVAL_DURATION=$(calc "$TOTAL_EVAL_DURATION + $EVAL_DURATION_S")
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

if [[ "$(echo "$TOTAL_EVAL_DURATION > 0" | bc)" -eq 1 ]]; then
  echo "  Avg tok/s:      $(calc "$TOTAL_EVAL_COUNT / $TOTAL_EVAL_DURATION")"
else
  echo "  Avg tok/s:      N/A"
fi

echo "  Results:         ${OUTPUT_DIR}"
