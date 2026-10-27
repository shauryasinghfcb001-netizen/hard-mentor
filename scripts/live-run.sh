#!/bin/zsh
# Execute or source safely: all variables and options live in this subshell.
(
  unsetopt XTRACE VERBOSE
  emulate -LR zsh
  setopt ERR_EXIT NO_UNSET PIPE_FAIL NO_CLOBBER
  umask 077
  typeset failure_reason='initialization failed'
  # Never interpolate commands, user input, URLs, or exception text into errors.
  TRAPEXIT() {
    local code=$?
    if (( code != 0 )); then
      print -ru2 -- "live-run: ${failure_reason} (exit ${code})"
    fi
  }
  TRAPINT() { failure_reason='interrupted'; exit 130; }
  TRAPTERM() { failure_reason='terminated'; exit 143; }
  cd -- "${${(%):-%x}:A:h:h}"
  typeset query_only=0
  typeset -a mode_args=()
  if [[ ${1:-} == --clean ]]; then
    shift
  else
    # Preserve only the explicitly recognized mode through the clean child.
    [[ $# == 0 || ( $# == 1 && $1 == --query-only ) ]] || exit 2
    [[ ${1:-} != --query-only ]] || mode_args=(--query-only)
    failure_reason='clean environment launch failed'
    /usr/bin/env -i PATH="$PATH" /bin/zsh -f scripts/live-run.sh --clean "${mode_args[@]}" && exit 0
    typeset child_status=$?
    unfunction TRAPEXIT
    exit $child_status
  fi
  [[ $# == 0 || ( $# == 1 && $1 == --query-only ) ]] || exit 2
  [[ ${1:-} != --query-only ]] || query_only=1
  # Start the owner process with a clean environment; no state/token-file fallback.
  failure_reason='runtime setup failed'
  ulimit -c 0
  command -v node >/dev/null 2>&1 || exit 127
  typeset HM_ZETARIS_USER HM_ZETARIS_PASSWORD
  typeset HM_STUDY_SOURCE='zetaris'
  # These /api/auth and /api/proxy routes belong to the UI, not REST port 8888.
  typeset HM_ZETARIS_URL='http://127.0.0.1:3000'
  typeset HM_ZETARIS_TABLE='hard_mentor.study_records'
  typeset answer
  failure_reason='terminal input unavailable or cancelled'
  read -r -s 'answer?HM_STUDY_SOURCE [zetaris] (Enter confirms): ' </dev/tty
  print -u2
  [[ -z $answer ]] || HM_STUDY_SOURCE=$answer
  read -r -s 'answer?HM_ZETARIS_URL [http://127.0.0.1:3000] (Enter confirms): ' </dev/tty
  print -u2
  [[ -z $answer ]] || HM_ZETARIS_URL=$answer
  read -r -s 'answer?HM_ZETARIS_TABLE [hard_mentor.study_records] (Enter confirms): ' </dev/tty
  print -u2
  [[ -z $answer ]] || HM_ZETARIS_TABLE=$answer
  failure_reason='invalid local Zetaris configuration'
  (
    export HM_STUDY_SOURCE HM_ZETARIS_URL HM_ZETARIS_TABLE TSX_DISABLE_CACHE=1
    node --import tsx scripts/live-run-preflight.ts
  ) >/dev/null 2>&1 && typeset preflight_status=0 || typeset preflight_status=$?
  if (( preflight_status != 0 )); then
    if (( preflight_status == 3 )); then
      failure_reason='Zetaris port closed or unreachable; start the local platform'
    fi
    exit $preflight_status
  fi
  failure_reason='terminal input unavailable or cancelled'
  if (( ! query_only )); then
    typeset METERLESS_TOKEN
    read -r -s 'METERLESS_TOKEN?METERLESS_TOKEN: ' </dev/tty
    print -u2
  fi
  read -r -s 'HM_ZETARIS_USER?HM_ZETARIS_USER: ' </dev/tty
  print -u2
  read -r -s 'HM_ZETARIS_PASSWORD?HM_ZETARIS_PASSWORD: ' </dev/tty
  print -u2
  failure_reason='zetaris_login_failed'
  [[ -n $HM_ZETARIS_USER && -n $HM_ZETARIS_PASSWORD ]] || exit 11
  if (( query_only )); then
    failure_reason='query-only failed; inspect sanitized result'
    (
      export HM_ZETARIS_USER HM_ZETARIS_PASSWORD
      export HM_STUDY_SOURCE HM_ZETARIS_URL HM_ZETARIS_TABLE TSX_DISABLE_CACHE=1
      exec node --import tsx scripts/zetaris-query.ts --bounded
    ) 2>/dev/null && exit 0
    exit $?
  fi
  failure_reason='token_missing'
  [[ -n ${METERLESS_TOKEN//[[:space:]]/} ]] || exit 10
  failure_reason='evidence directory creation failed'
  mkdir -p evidence
  typeset evidence_file="evidence/live-$(date +%Y%m%d-%H%M%S)-$$.json"
  typeset run_status=0
  failure_reason='verifier_failed'
  (
    export METERLESS_TOKEN HM_ZETARIS_USER HM_ZETARIS_PASSWORD
    # HM_LIVE_RUN selects the verified concrete local pin in live-run-safety.ts.
    # Its :local suffix carries the floor independently of the app's bind.
    export HM_STUDY_SOURCE HM_ZETARIS_URL HM_ZETARIS_TABLE
    export HM_LIVE_RUN=1 TSX_DISABLE_CACHE=1
    exec node --import tsx scripts/verify-product-path.ts
  ) > "$evidence_file" 2>/dev/null || run_status=$?
  unset METERLESS_TOKEN HM_ZETARIS_USER HM_ZETARIS_PASSWORD answer
  if (( run_status != 0 )); then
    failure_reason=$(node --import tsx scripts/live-run-diagnostics.ts "$evidence_file" "$run_status" 2>/dev/null) || failure_reason='verifier_failed'
    exit $run_status
  fi
  failure_reason='verifier evidence missing or invalid'
  node --import tsx --input-type=module -e '
    import fs from "node:fs";
    import { formatLiveSummary } from "./scripts/live-run-safety.ts";
    try { console.log(formatLiveSummary(JSON.parse(fs.readFileSync(process.argv[1], "utf8")))); }
    catch { process.exitCode = 1; }
  ' "$evidence_file" 2>/dev/null || exit 1
)
