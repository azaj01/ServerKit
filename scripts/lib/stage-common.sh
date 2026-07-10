# shellcheck shell=bash
#
# scripts/lib/stage-common.sh — pure helpers shared by the staging tooling.
#
# Both halves of the staging testbed source this file:
#   * scripts/stage.sh        (runs on the operator's laptop / an agent channel)
#   * scripts/stage-remote.sh (runs on the target box, from the uploaded payload)
#
# Everything here is a PURE function: no host mutation, no network, no prompts —
# just string/formatting logic that scripts/test/test_stage.sh can exercise
# against fixtures with no server (the same source-and-test discipline that made
# scripts/update.sh reliable). Keep it bash-3-portable and shellcheck-clean: CI
# runs `shellcheck --severity=warning -x scripts/lib/*.sh` across a 7-distro
# matrix.

# The rsync overlay exclusion list, verbatim from scripts/test/vm-install.sh's
# proven overlay (:86-96) plus the per-instance state a staging deploy must
# never carry across from the local checkout. Printed one pattern per line so a
# caller can build an `--exclude=` array from it; the SAME list is used for the
# `--dirty` upload (working tree → box) and the box-side source overlay.
#
# .env / instance DB / venvs / node_modules / dist / .git are all excluded
# because staging generates its OWN .env + keys + SQLite file and rebuilds the
# venv and the frontend bundle on the box.
stage_rsync_excludes() {
    cat <<'EOF'
.env
.git/
backend/instance/
backend/venv/
backend/.venv/
backend/.venv-wsl/
backend/__pycache__/
frontend/node_modules/
frontend/dist/
nginx/ssl/
deploy/targets/
EOF
}

# Emit the rsync exclusion patterns as ready-to-use `--exclude=<pat>` tokens,
# one per line. Callers `mapfile`/read them into an argv array.
stage_rsync_exclude_args() {
    local pat
    while IFS= read -r pat; do
        [ -n "$pat" ] || continue
        printf -- '--exclude=%s\n' "$pat"
    done < <(stage_rsync_excludes)
}

# JSON-escape a scalar string for embedding in the verdict line. Handles the
# characters that actually appear in our values (paths, commit hashes, error
# text): backslash, double-quote, tab, newline. Deliberately tiny — the verdict
# only ever carries controlled values, never arbitrary user input.
stage_json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\t'/\\t}"
    s="${s//$'\n'/\\n}"
    printf '%s' "$s"
}

# Format the single machine-readable verdict line that verify emits — the stable
# contract a human, a CI job, or an LLM session all parse the same way:
#
#   VERDICT {"target":"..","commit":"..","mode":"..","checks":{..},"pass":bool}
#
# Args: <target> <commit> <mode> <checks_json_object> <pass:0|1>
# <checks_json_object> is a pre-built JSON object literal (e.g. produced by
# stage_checks_to_json). Scalars are escaped; the checks object is spliced in
# as-is (the caller owns its shape).
stage_format_verdict() {
    local target="$1" commit="$2" mode="$3" checks="$4" pass="$5"
    local pass_bool="false"
    [ "$pass" = "1" ] || [ "$pass" = "true" ] && pass_bool="true"
    [ -n "$checks" ] || checks="{}"
    printf 'VERDICT {"target":"%s","commit":"%s","mode":"%s","checks":%s,"pass":%s}\n' \
        "$(stage_json_escape "$target")" \
        "$(stage_json_escape "$commit")" \
        "$(stage_json_escape "$mode")" \
        "$checks" \
        "$pass_bool"
}

# Turn a set of "name=state" check results on stdin into a JSON object mapping
# each check name to its state string, e.g.
#   health=pass\nlogin=pass\ndocker=skip  →  {"health":"pass","login":"pass","docker":"skip"}
# States are free-form strings (pass|fail|skip|...); both key and value are
# escaped. Order is preserved; an empty input yields {}.
stage_checks_to_json() {
    local line name state first=1 out="{"
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        name="${line%%=*}"
        state="${line#*=}"
        [ "$first" = "1" ] || out="$out,"
        first=0
        out="$out\"$(stage_json_escape "$name")\":\"$(stage_json_escape "$state")\""
    done
    out="$out}"
    printf '%s' "$out"
}

# The default remote layout, derived from the instance dir. The uploaded payload
# (repo tree + this lib + stage-remote.sh) lands in the ".src" sibling; the live
# staging instance runs from STAGE_DIR itself. Kept as a function so both halves
# agree on the path without repeating the string.
stage_src_dir() {
    printf '%s.src' "$1"
}
