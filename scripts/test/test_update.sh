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
# T8 — version comparison: versions_equal ignores a leading "v".
# --------------------------------------------------------------------------
if ( set -Eeuo pipefail; versions_equal v1.7.1 1.7.1 ) && \
   ( set -Eeuo pipefail; versions_equal 1.7.1 1.7.1 ) && \
   ! ( set -Eeuo pipefail; versions_equal 1.7.0 1.7.1 ); then
    ok "versions_equal matches across a leading 'v' and rejects mismatches"
else
    bad "versions_equal comparison is wrong"
fi

# --------------------------------------------------------------------------
# T9 — is_already_current short-circuits to "proceed" (non-zero) under --force
# and offline, without any network/git access.
# --------------------------------------------------------------------------
if ( set -Eeuo pipefail; FORCE_UPDATE=1; is_already_current ); then
    bad "is_already_current must proceed (non-zero) under --force"
else
    ok "is_already_current proceeds under --force (skips the version check)"
fi
if ( set -Eeuo pipefail; FORCE_UPDATE=0; SERVERKIT_OFFLINE_TARBALL=/x; is_already_current ); then
    bad "is_already_current must proceed (non-zero) when offline"
else
    ok "is_already_current proceeds when offline (can't compare)"
fi

# --------------------------------------------------------------------------
# T10 — the rollback-safety fix: migrate_database must run the migration
# against the NEW slot's database copy (slot-absolute path), never the
# /opt/serverkit symlink that still resolves to the live old slot. A flask
# stub captures the DATABASE_URL the migration actually used.
# --------------------------------------------------------------------------
t="$WORK/t10/serverkit-b"
mkdir -p "$t/venv/bin" "$t/backend/instance"
: > "$t/venv/bin/activate"                              # sourceable no-op
: > "$t/backend/instance/serverkit.db"                  # the slot's DB copy
printf 'DATABASE_URL=sqlite:///opt/serverkit/backend/instance/serverkit.db\n' > "$t/.env"
FLASK_CAP="$WORK/t10/flask-saw-dburl"
cat > "$STUB_BIN/flask" <<EOF
#!/usr/bin/env bash
printf '%s' "\${DATABASE_URL:-NONE}" > "$FLASK_CAP"
exit 0
EOF
chmod +x "$STUB_BIN/flask"
(
    set -Eeuo pipefail
    DRY_RUN=0
    migrate_database "$t"
) >/dev/null 2>&1
saw="$(tr -d '\r' < "$FLASK_CAP" 2>/dev/null || true)"
if [ "$saw" = "sqlite:///$t/backend/instance/serverkit.db" ]; then
    ok "migrate_database targets the new slot's DB, leaving the old slot untouched"
else
    bad "migrate_database used [$saw], expected the slot-absolute new-slot DB path"
fi
rm -f "$STUB_BIN/flask"

# --------------------------------------------------------------------------
# T11 — zero-downtime regression: reload_nginx_graceful must RELOAD a running
# nginx and must NEVER stop it. Host nginx fronts every managed app, so a stop
# during a panel update used to black out unrelated sites. A recording systemctl
# stub (PATH-prepended ahead of the global stub) captures every invocation.
# --------------------------------------------------------------------------
t="$WORK/t11"; mkdir -p "$t/bin"
CALL_LOG="$t/calls.log"; : > "$CALL_LOG"
cat > "$t/bin/systemctl" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$CALL_LOG"
exit 0                       # is-active --quiet nginx → running
EOF
cat > "$t/bin/nginx" <<EOF
#!/usr/bin/env bash
printf 'nginx %s\n' "\$*" >> "$CALL_LOG"
exit 0                       # nginx -t passes
EOF
chmod +x "$t/bin"/*
if (
    set -Eeuo pipefail
    export PATH="$t/bin:$PATH"
    DRY_RUN=0
    reload_nginx_graceful
) >/dev/null 2>&1; then
    if grep -q 'reload nginx' "$CALL_LOG" && ! grep -q 'stop nginx' "$CALL_LOG"; then
        ok "reload_nginx_graceful reloads a running nginx and never stops it (zero-downtime)"
    else
        bad "reload_nginx_graceful must reload (not stop) nginx; saw: $(tr '\n' ';' < "$CALL_LOG")"
    fi
else
    bad "reload_nginx_graceful returned non-zero against a healthy running nginx"
fi

# --------------------------------------------------------------------------
# T12 — when nginx is NOT running, reload_nginx_graceful starts it (instead of
# reloading a dead service) and still never issues a stop. The is-active gate
# reports inactive on its first probe, then active so wait_for_service returns
# immediately (keeps the test sub-second).
# --------------------------------------------------------------------------
t="$WORK/t12"; mkdir -p "$t/bin"
CALL_LOG="$t/calls.log"; : > "$CALL_LOG"; : > "$t/probe"
cat > "$t/bin/systemctl" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$CALL_LOG"
if [ "\$*" = "is-active --quiet nginx" ]; then
    n=\$(cat "$t/probe" 2>/dev/null || echo 0); echo \$((n + 1)) > "$t/probe"
    [ "\$n" -ge 1 ] && exit 0 || exit 1      # 1st probe: down → start branch; then up
fi
exit 0
EOF
chmod +x "$t/bin"/*
if (
    set -Eeuo pipefail
    export PATH="$t/bin:$PATH"
    DRY_RUN=0
    reload_nginx_graceful
) >/dev/null 2>&1; then
    if grep -q 'start nginx' "$CALL_LOG" && ! grep -q 'stop nginx' "$CALL_LOG" \
       && ! grep -q 'reload nginx' "$CALL_LOG"; then
        ok "reload_nginx_graceful starts a stopped nginx (never reloads a dead unit, never stops)"
    else
        bad "reload_nginx_graceful should start (not reload/stop) a dead nginx; saw: $(tr '\n' ';' < "$CALL_LOG")"
    fi
else
    bad "reload_nginx_graceful returned non-zero while starting a stopped nginx"
fi

# --------------------------------------------------------------------------
# T13 — guard against the old behaviour creeping back: the update.sh source must
# not contain a literal `systemctl stop nginx`. The forward and rollback paths
# both route nginx through reload_nginx_graceful now.
# --------------------------------------------------------------------------
if grep -nq 'systemctl stop nginx' "$UPDATE_SH"; then
    bad "update.sh still contains 'systemctl stop nginx' — apps would black out on update"
else
    ok "update.sh never stops nginx (no 'systemctl stop nginx' anywhere)"
fi

# --------------------------------------------------------------------------
# T14 — the panel frontend is served statically from $INSTALL_DIR/frontend/dist.
# refresh_config must repoint the shipped `root` (default /opt/serverkit) at a
# customised SERVERKIT_DIR, or a custom install dir would 404 the whole panel
# after an upgrade.
# --------------------------------------------------------------------------
t="$WORK/t14"
mkdir -p "$t/nginx/sites-available" "$t/nginx/sites-enabled" "$t/target/nginx/sites-available"
printf 'http {\n}\n' > "$t/nginx/nginx.conf"
printf 'server {\n  root /opt/serverkit/frontend/dist;\n  location / { try_files $uri /index.html; }\n}\n' \
    > "$t/target/nginx/sites-available/serverkit-insecure.conf"
(
    set -Eeuo pipefail
    NGINX_DIR="$t/nginx"; LETSENCRYPT_DIR="$t/le"; SYSTEMD_DIR="$t/sysd"; CONFIG_DIR="$t/cfg"; DRY_RUN=0
    INSTALL_DIR="$WORK/opt/serverkit"     # non-default → substitution must fire
    refresh_config "$t/target"
) >/dev/null 2>&1
installed="$t/nginx/sites-available/serverkit-insecure.conf"
if grep -q "root $WORK/opt/serverkit/frontend/dist;" "$installed" \
   && ! grep -q "root /opt/serverkit/frontend/dist;" "$installed"; then
    ok "refresh_config repoints the static-frontend root at a custom SERVERKIT_DIR"
else
    bad "refresh_config did not rewrite the frontend dist root: $(grep -n root "$installed" | tr '\n' ';')"
fi

# --------------------------------------------------------------------------
# T15 — the shipped nginx sites serve the SPA statically (host nginx, no
# container): each must carry a frontend/dist root + a try_files SPA fallback
# and must NOT proxy the retired frontend container on :3847.
# --------------------------------------------------------------------------
SK_ROOT="$SCRIPT_DIR/../.."
for f in serverkit.conf serverkit-insecure.conf; do
    cfg="$SK_ROOT/nginx/sites-available/$f"
    if grep -q 'frontend/dist' "$cfg" && grep -q 'try_files' "$cfg" \
       && ! grep -q '127.0.0.1:3847' "$cfg"; then
        ok "$f serves the SPA statically (dist root + try_files, no :3847 proxy)"
    else
        bad "$f is not a clean static-serve config (still proxying :3847?)"
    fi
done

# --------------------------------------------------------------------------
# T16 — app-uptime verification: discover_app_upstreams must extract the unique
# set of app container upstreams from the per-app nginx location snippets (this
# is the list the updater probes to prove apps stayed up).
# --------------------------------------------------------------------------
t="$WORK/t16"; mkdir -p "$t/loc"
printf 'location /app1 { proxy_pass http://127.0.0.1:8001; }\n' > "$t/loc/app1.conf"
printf 'location /app2  { proxy_pass http://127.0.0.1:8002/; }\nlocation /app2b { proxy_pass http://127.0.0.1:8001; }\n' > "$t/loc/app2.conf"
res="$( set -Eeuo pipefail; APP_LOCATIONS_DIR="$t/loc"; discover_app_upstreams | tr '\n' ',' )"
if [ "$res" = "127.0.0.1:8001,127.0.0.1:8002," ]; then
    ok "discover_app_upstreams extracts the unique app upstreams from location snippets"
else
    bad "discover_app_upstreams returned [$res], expected the two unique upstreams"
fi

# --------------------------------------------------------------------------
# T17 — report_app_uptime_regressions flags an app that was reachable before the
# update and is not after (and ignores one that was already down), returning
# non-zero so the operator is warned; the clean case returns success.
# --------------------------------------------------------------------------
before=$'127.0.0.1:8001 up\n127.0.0.1:8002 up\n127.0.0.1:8003 down'
after=$'127.0.0.1:8001 up\n127.0.0.1:8002 down\n127.0.0.1:8003 down'
if ( set -Eeuo pipefail; report_app_uptime_regressions "$before" "$after" ) >/dev/null 2>&1; then
    bad "report_app_uptime_regressions should flag the app that went up->down"
else
    ok "report_app_uptime_regressions flags an app that went down across the update"
fi
if ( set -Eeuo pipefail; report_app_uptime_regressions "$before" "$before" ) >/dev/null 2>&1; then
    ok "report_app_uptime_regressions passes when every app that was up is still up"
else
    bad "report_app_uptime_regressions should pass when nothing regressed"
fi

# --------------------------------------------------------------------------
printf '\n%d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ]
