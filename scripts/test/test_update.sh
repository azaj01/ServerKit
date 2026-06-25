#!/usr/bin/env bash
#
# Unit tests for scripts/update.sh — runs in seconds, no server, no deploy.
#
# update.sh is source-able: when sourced it defines every function and then
# returns *before* the run block (the BASH_SOURCE guard). That lets us exercise
# the config-refresh + deployment-detection logic against throwaway fixtures
# instead of a real /etc and a real cloud box — which is what made this script
# so painful to get right.
#
# Each unit-under-test runs in a subshell that re-enables `set -Eeuo pipefail`,
# so a regression of the kind that bit 1.7.0 (an unguarded command silently
# aborting under set -e) is caught here as a failed assertion.
#
# Run:  bash scripts/test/test_update.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_SH="$SCRIPT_DIR/../update.sh"

PASS=0
FAIL=0
SKIP=0
ok()   { PASS=$((PASS + 1)); printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31m✘\033[0m %s\n' "$1"; }
skip() { SKIP=$((SKIP + 1)); printf '  \033[33m∼\033[0m %s (skipped)\n' "$1"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --------------------------------------------------------------------------
# Stub the external commands the functions may shell out to, so the tests
# never touch the host's nginx/systemd/docker.
# --------------------------------------------------------------------------
STUB_BIN="$WORK/bin"
mkdir -p "$STUB_BIN"
for cmd in systemctl nginx npm curl; do
    printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB_BIN/$cmd"
done
# docker stub: `docker ps ...` lists the fixture container names; anything else
# (image inspect/tag/compose/...) is a harmless no-op.
cat > "$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  ps) for n in ${SERVERKIT_TEST_CONTAINERS:-}; do printf '%s\n' "$n"; done ;;
  *)  exit 0 ;;
esac
EOF
chmod +x "$STUB_BIN"/*
export PATH="$STUB_BIN:$PATH"

# --------------------------------------------------------------------------
# Source update.sh (functions only). Keep logging off and point the install
# dir at the sandbox so the derived DIR_A/DIR_B land under $WORK.
# --------------------------------------------------------------------------
export SERVERKIT_NO_LOG=1
export SERVERKIT_DIR="$WORK/opt/serverkit"
# shellcheck disable=SC1090
source "$UPDATE_SH"
set +e +u   # hand control back to the harness; tests re-arm set -e per subshell

printf '\nupdate.sh unit tests\n\n'

# --------------------------------------------------------------------------
# T1 — the headline regression: refresh_config must NOT die when the live
# nginx has no serverkit.conf (HTTP-only boxes). This is the exact 1.7.0
# silent-death that left the updater stuck reporting the old version.
# --------------------------------------------------------------------------
t="$WORK/t1"
mkdir -p "$t/nginx/sites-available" "$t/nginx/sites-enabled" "$t/target/nginx/sites-available"
printf 'http {\n}\n' > "$t/nginx/nginx.conf"
printf 'server { listen 80; }\n' > "$t/target/nginx/sites-available/serverkit-insecure.conf"
if (
    set -Eeuo pipefail
    NGINX_DIR="$t/nginx"; LETSENCRYPT_DIR="$t/le"; SYSTEMD_DIR="$t/sysd"; CONFIG_DIR="$t/cfg"; DRY_RUN=0
    refresh_config "$t/target"
) >/dev/null 2>&1; then
    ok "refresh_config survives a missing serverkit.conf (the 1.7.0 silent-death bug)"
else
    bad "refresh_config DIED on a missing serverkit.conf — the set -e/pipefail regression is back"
fi

# --------------------------------------------------------------------------
# T2 — refresh_config still works when a serverkit.conf with a real cert path
# is present (the grep finds a match).
# --------------------------------------------------------------------------
t="$WORK/t2"
mkdir -p "$t/nginx/sites-available" "$t/nginx/sites-enabled" "$t/target/nginx/sites-available" "$t/le/live/example.com"
printf 'http {\n}\n' > "$t/nginx/nginx.conf"
printf 'ssl_certificate %s/live/example.com/fullchain.pem;\n' "$t/le" > "$t/nginx/sites-available/serverkit.conf"
printf 'server { listen 80; }\n' > "$t/target/nginx/sites-available/serverkit-insecure.conf"
if (
    set -Eeuo pipefail
    NGINX_DIR="$t/nginx"; LETSENCRYPT_DIR="$t/le"; SYSTEMD_DIR="$t/sysd"; CONFIG_DIR="$t/cfg"; DRY_RUN=0
    refresh_config "$t/target"
) >/dev/null 2>&1; then
    ok "refresh_config handles a present serverkit.conf with a cert path"
else
    bad "refresh_config failed with a present serverkit.conf"
fi

# --------------------------------------------------------------------------
# T3 — deployment-shape detection (the bug that made 1.7.0 take the wrong path
# on an all-Docker box).
# --------------------------------------------------------------------------
t="$WORK/t3"; mkdir -p "$t/install"
touch "$t/install/docker-compose.yml"
if (
    set -Eeuo pipefail
    INSTALL_DIR="$t/install"
    export SERVERKIT_TEST_CONTAINERS="serverkit-backend serverkit-frontend"
    is_docker_deployment
); then
    ok "is_docker_deployment → docker when compose + container and no host venv"
else
    bad "is_docker_deployment should pick the docker path for an all-Docker box"
fi

mkdir -p "$t/install/venv/bin"
printf '#!/bin/sh\n' > "$t/install/venv/bin/python"; chmod +x "$t/install/venv/bin/python"
if (
    set -Eeuo pipefail
    INSTALL_DIR="$t/install"
    export SERVERKIT_TEST_CONTAINERS="serverkit-backend"
    is_docker_deployment
); then
    bad "is_docker_deployment should fall back to hybrid when a host venv exists"
else
    ok "is_docker_deployment → hybrid when a host venv exists (precedence)"
fi

# --------------------------------------------------------------------------
# T4 — blue/green slot resolution.
# --------------------------------------------------------------------------
t="$WORK/t4"; mkdir -p "$t/serverkit-a" "$t/serverkit-b"
ln -sfn "$t/serverkit-a" "$t/serverkit" 2>/dev/null || true
if [ ! -L "$t/serverkit" ]; then
    skip "active/next slot flip — symlinks unsupported here (works on Linux CI)"
else
    res="$(
        set -Eeuo pipefail
        INSTALL_DIR="$t/serverkit"; DIR_A="$t/serverkit-a"; DIR_B="$t/serverkit-b"
        printf '%s|%s' "$(active_real_dir)" "$(next_real_dir)"
    )"
    exp="$(readlink -f "$t/serverkit-a")|$t/serverkit-b"
    if [ "$res" = "$exp" ]; then
        ok "active/next slot flip (A active → B is next)"
    else
        bad "active/next slot wrong: got [$res] expected [$exp]"
    fi
fi

# --------------------------------------------------------------------------
# T5 — the loud-failure reporter actually emits a labelled diagnostic.
# --------------------------------------------------------------------------
out="$(LAST_PHASE='Refreshing Configuration' report_failure 2 42 'grep ... serverkit.conf' 2>&1)"
if printf '%s' "$out" | grep -q 'Update aborted'; then
    ok "report_failure emits a labelled 'Update aborted' diagnostic"
else
    bad "report_failure produced no diagnostic"
fi

# --------------------------------------------------------------------------
# T6 — self-update bootstrap skips cleanly under each opt-out, and never
# re-execs (would replace this test process) when there is nothing to do.
# --------------------------------------------------------------------------
self_update_skips() {
    # Each guard runs in a subshell with set -e; a clean return keeps the test
    # process alive, and any stray `exec` would visibly break the harness.
    ( set -Eeuo pipefail; SERVERKIT_UPDATER_REEXECED=1; DRY_RUN=0; maybe_reexec_latest_updater ) &&
    ( set -Eeuo pipefail; SERVERKIT_NO_SELF_UPDATE=1;  DRY_RUN=0; maybe_reexec_latest_updater ) &&
    ( set -Eeuo pipefail; DRY_RUN=1;                              maybe_reexec_latest_updater ) &&
    ( set -Eeuo pipefail; DRY_RUN=0; SERVERKIT_OFFLINE_TARBALL=/x; maybe_reexec_latest_updater )
}
if self_update_skips >/dev/null 2>&1; then
    ok "self-update no-ops under re-exec/opt-out/dry-run/offline guards"
else
    bad "self-update guard returned non-zero (would block or loop the updater)"
fi

# --------------------------------------------------------------------------
# T7 — the run lock refuses a second concurrent update.
# --------------------------------------------------------------------------
if command -v flock >/dev/null 2>&1; then
    lock="$WORK/update.lock"
    ( flock -n 9 || exit 1; sleep 3 ) 9>"$lock" &   # hold the lock
    held=$!
    sleep 0.3
    if ( set -Eeuo pipefail; LOCK_FILE="$lock"; DRY_RUN=0; acquire_update_lock ) >/dev/null 2>&1; then
        bad "acquire_update_lock should refuse while the lock is held"
    else
        ok "acquire_update_lock refuses a concurrent run while locked"
    fi
    kill "$held" 2>/dev/null || true; wait "$held" 2>/dev/null || true
    if ( set -Eeuo pipefail; LOCK_FILE="$WORK/free.lock"; DRY_RUN=0; acquire_update_lock ) >/dev/null 2>&1; then
        ok "acquire_update_lock succeeds when the lock is free"
    else
        bad "acquire_update_lock failed on a free lock"
    fi
else
    skip "run-lock test — flock unavailable here (runs on Linux CI)"
fi

# --------------------------------------------------------------------------
printf '\n%d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ]
