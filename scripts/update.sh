#!/bin/bash
#
# ServerKit updater — atomic blue/green, pre-flight checked, offline-capable.
#
# Usage:
#   bash /opt/serverkit/scripts/update.sh
#   bash /opt/serverkit/scripts/update.sh --dry-run
#   bash /opt/serverkit/scripts/update.sh --branch dev
#   bash /opt/serverkit/scripts/update.sh --release [v1.7.0]
#   SERVERKIT_OFFLINE_TARBALL=/tmp/serverkit-v1.7.0-linux-amd64.tar.gz bash /opt/serverkit/scripts/update.sh
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration + argument parsing
# ---------------------------------------------------------------------------
DRY_RUN=0
FORCE_UPDATE=0
TARGET_BRANCH=""
USE_RELEASE="${INSTALL_FROM_RELEASE:-0}"
RELEASE_VERSION="${SERVERKIT_VERSION:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run|-n)
            DRY_RUN=1
            shift
            ;;
        --force|-f)
            FORCE_UPDATE=1
            shift
            ;;
        --branch|-b)
            TARGET_BRANCH="$2"
            shift 2
            ;;
        --release|-r)
            USE_RELEASE=1
            if [[ -n "${2:-}" ]] && [[ ! "$2" =~ ^- ]]; then
                RELEASE_VERSION="$2"
                shift 2
            else
                shift
            fi
            ;;
        --help|-h)
            cat <<'EOF'
Usage: update.sh [OPTIONS]

Options:
  --dry-run, -n           Show what would happen without making changes
  --force, -f             Skip version comparison and update anyway
  --branch <name>, -b     Update from a git branch instead of main
  --release [version], -r Update from a release tarball
  --help, -h              Show this help message

Environment:
  SERVERKIT_DIR           Active install directory (default: /opt/serverkit)
  SERVERKIT_VENV_DIR      Python venv path (default: $SERVERKIT_DIR/venv)
  SERVERKIT_OFFLINE_TARBALL  Local release tarball to use instead of downloading
  SERVERKIT_MIRROR_URL    Base URL for release tarballs/checksums
  GITHUB_REPO             GitHub org/repo for source and releases
EOF
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SERVERKIT_DIR="${SERVERKIT_DIR:-/opt/serverkit}"
INSTALL_DIR="$SERVERKIT_DIR"
BASE_NAME="$(basename "$INSTALL_DIR")"
BASE_DIR="$(dirname "$INSTALL_DIR")"
DIR_A="$BASE_DIR/${BASE_NAME}-a"
DIR_B="$BASE_DIR/${BASE_NAME}-b"
VENV_DIR="${SERVERKIT_VENV_DIR:-$INSTALL_DIR/venv}"
BACKUP_DIR="/var/backups/serverkit"
LOG_DIR="/var/log/serverkit"
CONFIG_DIR="/etc/serverkit"

GITHUB_REPO="${GITHUB_REPO:-jhd3197/ServerKit}"
SERVERKIT_OFFLINE_TARBALL="${SERVERKIT_OFFLINE_TARBALL:-}"
SERVERKIT_MIRROR_URL="${SERVERKIT_MIRROR_URL:-}"
BACKEND_SERVICE="serverkit"

# ---------------------------------------------------------------------------
# Terminal styling
# ---------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
    ESC=$'\033'
    RST="${ESC}[0m"; BLD="${ESC}[1m"
    paint() { printf '%s[38;2;%d;%d;%dm' "$ESC" "$1" "$2" "$3"; }
else
    RST=''; BLD=''
    paint() { :; }
fi

V3="$(paint 139 92 246)"; V4="$(paint 124 58 237)"
PAPER="$(paint 237 233 254)"; FOG="$(paint 113 108 140)"
HUE_OK="$(paint 52 211 153)"; HUE_WARN="$(paint 250 204 21)"
HUE_ERR="$(paint 248 113 113)"; HUE_LINK="$(paint 103 232 249)"

good()  { printf '  %s✔%s %s\n' "$HUE_OK"   "$RST" "$1"; }
warn()  { printf '  %s▴%s %s\n' "$HUE_WARN" "$RST" "$1"; }
halt()  { printf '  %s✘%s %s\n' "$HUE_ERR"  "$RST" "$1" >&2; exit 1; }
step()  { printf '  %s❯%s %s\n' "$HUE_LINK" "$RST" "$1"; }
info()  { printf '  %s•%s %s\n' "$FOG"      "$RST" "$1"; }

STARTED_AT=0
PHASE_N=0
clock() {
    [ "$STARTED_AT" -gt 0 ] || { printf ''; return; }
    local secs=$(( $(date +%s) - STARTED_AT ))
    printf '%dm %02ds' "$((secs / 60))" "$((secs % 60))"
}
phase() {
    PHASE_N=$((PHASE_N + 1))
    printf '\n  %s%s%02d%s  %s%s%s  %s%s%s\n' \
        "$BLD" "$V3" "$PHASE_N" "$RST" "$BLD" "$1" "$RST" "$FOG" "$(clock)" "$RST"
    printf '  %s%s%s\n\n' "$V4" "──────────────────────────────────────" "$RST"
}

# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------
run_or_dry() {
    if [ "$DRY_RUN" = "1" ]; then
        info "[dry-run] would run: $*"
    else
        "$@"
    fi
}

wait_for_service() {
    local unit="$1" target_state="$2" timeout="${3:-30}"
    local waited=0
    while [ "$waited" -lt "$timeout" ]; do
        if systemctl is-active --quiet "$unit" 2>/dev/null; then
            [ "$target_state" = "active" ] && return 0
        else
            [ "$target_state" = "inactive" ] && return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    return 1
}

# Resolve the currently active real directory behind the symlink.
active_real_dir() {
    if [ -L "$INSTALL_DIR" ]; then
        readlink -f "$INSTALL_DIR"
    elif [ -d "$INSTALL_DIR" ]; then
        echo "$INSTALL_DIR"
    else
        echo ""
    fi
}

# Return the inactive blue/green directory.
next_real_dir() {
    local active
    active="$(active_real_dir)"
    if [ "$active" = "$DIR_A" ]; then
        echo "$DIR_B"
    else
        echo "$DIR_A"
    fi
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
preflight_check() {
    phase "Pre-flight Checks"

    # Root
    if [ "$EUID" -ne 0 ]; then
        halt "Run as root."
    fi
    good "Running as root"

    # Install directory exists or can be created
    if [ ! -e "$BASE_DIR" ]; then
        halt "Base directory $BASE_DIR does not exist."
    fi
    good "Install base directory exists"

    # Python version
    local py_bin py_version
    py_bin="$(locate_python 2>/dev/null || true)"
    if [ -z "$py_bin" ]; then
        halt "Python 3.11 or 3.12 is required. Install python3.11/3.12 and python3-venv."
    fi
    py_version="$($py_bin -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')"
    good "Python $py_version available ($py_bin)"

    # Required commands
    local cmd missing=()
    for cmd in git curl tar rsync systemctl nginx docker python3; do
        command -v "$cmd" &>/dev/null || missing+=("$cmd")
    done
    if ! docker compose version &>/dev/null && ! docker-compose --version &>/dev/null; then
        missing+=("docker compose")
    fi
    if [ ${#missing[@]} -gt 0 ]; then
        halt "Missing required tools: ${missing[*]}"
    fi
    good "Required tools available"

    # Disk space (need 2 GiB free on the install filesystem)
    local avail_kb avail_gb
    avail_kb="$(df -k "$BASE_DIR" | awk 'NR==2 {print $4}')"
    avail_gb=$((avail_kb / 1024 / 1024))
    if [ "$avail_gb" -lt 2 ]; then
        halt "Insufficient disk space on $BASE_DIR: ${avail_gb} GiB free (need at least 2 GiB)."
    fi
    good "Disk space OK (${avail_gb} GiB free)"

    # Memory (need 512 MiB free)
    local mem_avail_mb
    mem_avail_mb="$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
    if [ "$mem_avail_mb" -lt 512 ]; then
        warn "Low memory: ${mem_avail_mb} MiB available (recommend >= 512 MiB)."
    else
        good "Memory OK (${mem_avail_mb} MiB available)"
    fi

    # Network reachability (skip in offline mode)
    if [ -n "$SERVERKIT_OFFLINE_TARBALL" ]; then
        info "Offline tarball set; skipping network checks"
    elif [ "$USE_RELEASE" = "1" ] || [ -z "$TARGET_BRANCH" ]; then
        if ! curl -sfI "https://github.com" >/dev/null 2>&1; then
            halt "Cannot reach github.com. Set SERVERKIT_OFFLINE_TARBALL or fix network."
        fi
        good "Network reachability OK"
    fi

    # Current backend health (warn only; it may already be down)
    if curl -sf --max-time 5 http://127.0.0.1:5000/api/v1/system/health >/dev/null 2>&1; then
        good "Backend currently healthy"
    else
        warn "Backend is not currently responding on :5000 — will proceed anyway"
    fi
}

# ---------------------------------------------------------------------------
# Python virtual environment
# ---------------------------------------------------------------------------
locate_python() {
    local c v
    for c in python3.12 python3.11 python3; do
        if command -v "$c" &>/dev/null; then
            v="$($c -c 'import sys;print(".".join(map(str,sys.version_info[:2])))' 2>/dev/null || true)"
            if printf '%s\n%s' "3.11" "$v" | sort -C -V && \
               printf '%s\n%s' "$v" "3.12" | sort -C -V; then
                printf '%s' "$c"
                return 0
            fi
        fi
    done
    return 1
}

rebuild_virtualenv() {
    local target_dir="$1"
    step "Rebuilding Python virtual environment..."

    local py_bin
    py_bin="$(locate_python)" || halt "ServerKit requires Python 3.11 or 3.12."

    if [ "$DRY_RUN" = "1" ]; then
        info "[dry-run] would recreate venv at $target_dir using $py_bin"
        return 0
    fi

    rm -rf "$target_dir"
    "$py_bin" -m venv "$target_dir"
    # shellcheck source=/dev/null
    source "$target_dir/bin/activate"
    pip install --upgrade pip --quiet
    pip install -r "$target_dir/../backend/requirements.txt" --quiet
    pip install gunicorn gevent gevent-websocket --quiet
    good "Virtual environment rebuilt at $target_dir"
}

# Ensure the target directory has a usable venv. If a pre-built one exists, use
# it; otherwise rebuild from requirements.
require_venv() {
    local target_dir="$1"
    if [ -f "$target_dir/bin/activate" ] && [ -x "$target_dir/bin/python" ]; then
        good "Virtual environment ready at $target_dir"
        return 0
    fi
    warn "Virtual environment missing at $target_dir"
    rebuild_virtualenv "$target_dir"
}

# ---------------------------------------------------------------------------
# Database migration
# ---------------------------------------------------------------------------
migrate_database() {
    local work_dir="$1"
    local venv="$work_dir/venv"

    step "Running database migrations..."
    if [ "$DRY_RUN" = "1" ]; then
        info "[dry-run] would run flask db upgrade in $work_dir/backend"
        return 0
    fi

    # shellcheck source=/dev/null
    source "$venv/bin/activate"
    cd "$work_dir/backend"

    if ! FLASK_ENV=production flask db upgrade; then
        halt "Database migration failed. The previous installation is still active."
    fi
    good "Database migrated"
}

# ---------------------------------------------------------------------------
# Release download + checksum verification
# ---------------------------------------------------------------------------
download_release() {
    local version="$1"
    local arch output tmp_dir base_url checksum_file tarball_url

    case "$(uname -m)" in
        x86_64|amd64)  arch="amd64" ;;
        aarch64|arm64) arch="arm64" ;;
        *)             halt "Unsupported architecture: $(uname -m)" ;;
    esac

    if [ -n "$SERVERKIT_OFFLINE_TARBALL" ]; then
        [ -f "$SERVERKIT_OFFLINE_TARBALL" ] || halt "Offline tarball not found: $SERVERKIT_OFFLINE_TARBALL"
        echo "$SERVERKIT_OFFLINE_TARBALL"
        return 0
    fi

    if [ -n "$SERVERKIT_MIRROR_URL" ]; then
        base_url="$SERVERKIT_MIRROR_URL"
    else
        base_url="https://github.com/${GITHUB_REPO}/releases/download/${version}"
    fi

    tarball_url="${base_url}/serverkit-${version}-linux-${arch}.tar.gz"
    checksum_url="${base_url}/checksums.txt"
    tmp_dir="$(mktemp -d)"
    output="$tmp_dir/serverkit-${version}-linux-${arch}.tar.gz"

    step "Downloading release tarball (${arch})..."
    curl -sfL "$tarball_url" -o "$output" || halt "Failed to download $tarball_url"

    step "Verifying checksum..."
    if curl -sfL "$checksum_url" -o "$tmp_dir/checksums.txt"; then
        cd "$tmp_dir"
        if ! sha256sum -c <(grep "serverkit-${version}-linux-${arch}.tar.gz" checksums.txt) >/dev/null 2>&1; then
            halt "Checksum verification failed for release tarball."
        fi
        good "Checksum verified"
    else
        warn "Could not download checksums.txt — skipping verification"
    fi

    echo "$output"
}

# ---------------------------------------------------------------------------
# Blue/green directory management
# ---------------------------------------------------------------------------
ensure_bluegreen_layout() {
    # Convert legacy single-directory installs into the blue/green symlink layout.
    if [ -d "$INSTALL_DIR" ] && [ ! -L "$INSTALL_DIR" ]; then
        step "Migrating to blue/green layout..."
        if [ "$DRY_RUN" = "1" ]; then
            info "[dry-run] would move $INSTALL_DIR → $DIR_A and symlink $INSTALL_DIR → $DIR_A"
            return 0
        fi
        mv "$INSTALL_DIR" "$DIR_A"
        ln -s "$DIR_A" "$INSTALL_DIR"
        good "Migrated to blue/green layout"
    fi

    # Ensure both slots exist.
    if [ "$DRY_RUN" = "0" ]; then
        mkdir -p "$DIR_A" "$DIR_B"
    fi
}

atomic_switch() {
    local target="$1"
    if [ "$DRY_RUN" = "1" ]; then
        info "[dry-run] would switch symlink $INSTALL_DIR → $target"
        return 0
    fi
    ln -sfn "$target" "${INSTALL_DIR}.tmp"
    mv -Tf "${INSTALL_DIR}.tmp" "$INSTALL_DIR"
    good "Switched active install to $target"
}

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
backup_current() {
    phase "Database Backup"
    mkdir -p "$BACKUP_DIR"

    local active db_file backup_file
    active="$(active_real_dir)"
    db_file="$active/backend/instance/serverkit.db"

    if [ -f "$db_file" ]; then
        backup_file="$BACKUP_DIR/serverkit-pre-upgrade-$(date +%Y%m%d-%H%M%S).db"
        run_or_dry cp "$db_file" "$backup_file"
        good "Database backed up to $backup_file"
    else
        warn "No SQLite database at $db_file — skipping DB backup"
    fi

    local tree_backup
    tree_backup="$BACKUP_DIR/serverkit-tree-$(date +%Y%m%d-%H%M%S)"
    if [ -d "$active" ]; then
        run_or_dry rsync -a --exclude=venv --exclude=backups --exclude=node_modules \
            "$active/" "$tree_backup/" 2>/dev/null || \
            run_or_dry cp -a "$active" "$tree_backup" 2>/dev/null || true
        good "Install tree backed up to $tree_backup"
    fi
}

# ---------------------------------------------------------------------------
# Deploy source into the next directory
# ---------------------------------------------------------------------------
deploy_source() {
    local target="$1"
    local branch="${2:-main}"

    phase "Updating Source"

    if [ "$DRY_RUN" = "1" ]; then
        info "[dry-run] would clone/pull $GITHUB_REPO:$branch into $target"
        return 0
    fi

    # Preserve .env and database across rewrites.
    local tmp_env tmp_db
    tmp_env="$(mktemp)"
    tmp_db="$(mktemp)"
    cp "$INSTALL_DIR/.env" "$tmp_env" 2>/dev/null || true
    cp "$INSTALL_DIR/backend/instance/serverkit.db" "$tmp_db" 2>/dev/null || true

    rm -rf "$target"
    git clone --depth 1 --branch "$branch" "https://github.com/${GITHUB_REPO}.git" "$target" \
        || halt "Failed to clone ${GITHUB_REPO}:$branch"

    cp "$tmp_env" "$target/.env" 2>/dev/null || true
    mkdir -p "$target/backend/instance"
    cp "$tmp_db" "$target/backend/instance/serverkit.db" 2>/dev/null || true
    rm -f "$tmp_env" "$tmp_db"

    chmod +x "$target/serverkit"
    chmod +x "$target/scripts/"*.sh 2>/dev/null || true

    good "Source updated to $branch in $target"
}

# ---------------------------------------------------------------------------
# Deploy release tarball into the next directory
# ---------------------------------------------------------------------------
deploy_release() {
    local target="$1"
    local version="$2"

    phase "Downloading Release"

    local tarball stage unpacked
    tarball="$(download_release "$version")"

    if [ "$DRY_RUN" = "1" ]; then
        info "[dry-run] would unpack $tarball into $target"
        return 0
    fi

    stage="$(mktemp -d)"
    tar xzf "$tarball" -C "$stage"

    unpacked="$stage/serverkit"
    [ ! -d "$unpacked" ] && unpacked="$stage/opt/serverkit"
    if [ ! -d "$unpacked" ]; then
        unpacked="$(find "$stage" -maxdepth 2 -type d -name serverkit | head -n1)"
    fi
    [ -d "$unpacked" ] || halt "Release tarball layout is unrecognized"

    # Preserve live state.
    cp "$INSTALL_DIR/.env" "$unpacked/.env" 2>/dev/null || true
    mkdir -p "$unpacked/backend/instance"
    cp "$INSTALL_DIR/backend/instance/serverkit.db" "$unpacked/backend/instance/serverkit.db" 2>/dev/null || true

    rm -rf "$target"
    cp -a "$unpacked" "$target"
    rm -rf "$stage"

    chmod +x "$target/serverkit"
    chmod +x "$target/scripts/"*.sh 2>/dev/null || true

    good "Release $version deployed to $target"
}

# ---------------------------------------------------------------------------
# Configuration refresh
# ---------------------------------------------------------------------------
refresh_config() {
    local target="$1"

    phase "Refreshing Configuration"

    if [ "$DRY_RUN" = "1" ]; then
        info "[dry-run] would refresh nginx + systemd configs from $target"
        return 0
    fi

    # Recover panel domain from live nginx config.
    local prior_panel_domain=""
    prior_panel_domain=$(grep -oE '/etc/letsencrypt/live/[^/]+/' \
        /etc/nginx/sites-available/serverkit.conf 2>/dev/null | head -n1 | \
        sed -E 's|.*/live/([^/]+)/|\1|')
    [ "$prior_panel_domain" = "YOUR_DOMAIN" ] && prior_panel_domain=""

    if [ -f "$target/nginx/sites-available/serverkit.conf" ]; then
        cp "$target/nginx/sites-available/serverkit.conf" /etc/nginx/sites-available/
    fi
    if [ -f "$target/nginx/sites-available/serverkit-insecure.conf" ]; then
        cp "$target/nginx/sites-available/serverkit-insecure.conf" /etc/nginx/sites-available/
    fi

    # TLS floor
    if [ -f /etc/nginx/nginx.conf ]; then
        local ciphers='ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384'
        if grep -qE '^[[:space:]]*ssl_protocols[[:space:]]' /etc/nginx/nginx.conf; then
            sed -i -E 's|^([[:space:]]*)ssl_protocols[[:space:]].*|\1ssl_protocols TLSv1.2 TLSv1.3;|' /etc/nginx/nginx.conf
        else
            sed -i '/http {/a \    ssl_protocols TLSv1.2 TLSv1.3;' /etc/nginx/nginx.conf
        fi
        if grep -qE '^[[:space:]]*ssl_ciphers[[:space:]]' /etc/nginx/nginx.conf; then
            sed -i -E "s|^([[:space:]]*)ssl_ciphers[[:space:]].*|\1ssl_ciphers ${ciphers};|" /etc/nginx/nginx.conf
        else
            sed -i "/http {/a \\    ssl_ciphers ${ciphers};" /etc/nginx/nginx.conf
        fi
    fi

    # SSL mode
    local ssl_mode="insecure"
    if [ -f "$CONFIG_DIR/ssl-mode" ]; then
        ssl_mode="$(cat "$CONFIG_DIR/ssl-mode")"
    fi
    if [ "$ssl_mode" = "secure" ] && [ -f /etc/nginx/sites-available/serverkit.conf ]; then
        local panel_domain=""
        if [ -f "$CONFIG_DIR/panel-domain" ]; then
            panel_domain="$(cat "$CONFIG_DIR/panel-domain" 2>/dev/null || true)"
        fi
        [ -z "$panel_domain" ] && panel_domain="$prior_panel_domain"

        if [ -n "$panel_domain" ] && [ -d "/etc/letsencrypt/live/$panel_domain" ]; then
            sed -i "s|/etc/letsencrypt/live/YOUR_DOMAIN/|/etc/letsencrypt/live/$panel_domain/|g" \
                /etc/nginx/sites-available/serverkit.conf
            ln -sf /etc/nginx/sites-available/serverkit.conf /etc/nginx/sites-enabled/serverkit.conf
        else
            warn "SSL mode is 'secure' but no certificate found for '${panel_domain:-unknown}'"
            ln -sf /etc/nginx/sites-available/serverkit-insecure.conf /etc/nginx/sites-enabled/serverkit.conf
        fi
    else
        ln -sf /etc/nginx/sites-available/serverkit-insecure.conf /etc/nginx/sites-enabled/serverkit.conf
    fi

    # Service unit
    if [ -f "$target/serverkit-backend.service" ]; then
        cp "$target/serverkit-backend.service" /etc/systemd/system/serverkit.service
    fi
    systemctl daemon-reload
    good "Configuration refreshed"
}

# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------
rollback() {
    warn "Update failed — rolling back to previous slot..."

    if [ -z "${PREVIOUS_DIR:-}" ] || [ ! -d "$PREVIOUS_DIR" ]; then
        halt "Cannot roll back: previous installation directory not available"
    fi

    systemctl stop "$BACKEND_SERVICE" 2>/dev/null || true
    wait_for_service "$BACKEND_SERVICE" inactive 30 || true
    systemctl stop nginx 2>/dev/null || true
    wait_for_service nginx inactive 15 || true

    atomic_switch "$PREVIOUS_DIR"

    systemctl daemon-reload
    systemctl start "$BACKEND_SERVICE" 2>/dev/null || true
    wait_for_service "$BACKEND_SERVICE" active 30 || true
    cd "$INSTALL_DIR" && docker compose up -d --force-recreate frontend 2>&1 | tail -5
    docker compose up -d backend 2>&1 | tail -5
    systemctl start nginx 2>/dev/null || true
    wait_for_service nginx active 15 || true

    halt "Rolled back to $(active_real_dir). Inspect logs: journalctl -u serverkit -n 50"
}

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
health_check() {
    phase "Health Check"

    if [ "$DRY_RUN" = "1" ]; then
        info "[dry-run] would probe http://127.0.0.1:5000/api/v1/system/health"
        return 0
    fi

    step "Waiting for backend..."
    local waited=0
    while [ "$waited" -lt 60 ]; do
        if curl -sf --max-time 5 http://127.0.0.1:5000/api/v1/system/health >/dev/null 2>&1; then
            good "Backend healthy"
            break
        fi
        sleep 2
        waited=$((waited + 2))
    done
    if [ "$waited" -ge 60 ]; then
        rollback
    fi

    if ! curl -sf --max-time 5 http://127.0.0.1:5000/api/v1/system/health >/dev/null 2>&1; then
        rollback
    fi

    # Verify frontend container is running.
    if docker compose ps 2>/dev/null | grep -q "frontend.*Up"; then
        good "Frontend container running"
    else
        warn "Frontend container not reported as Up yet"
    fi

    HEALTH_PASSED=1
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
cleanup() {
    phase "Cleanup"

    if [ "$DRY_RUN" = "1" ]; then
        info "[dry-run] would trim old backups"
        return 0
    fi

    ls -t "$BACKUP_DIR"/serverkit-tree-*          2>/dev/null | tail -n +11 | xargs -r rm -rf
    ls -t "$BACKUP_DIR"/serverkit-pre-upgrade-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f

    local new_version
    new_version="$(cat "$INSTALL_DIR/VERSION" 2>/dev/null | tr -d '\n\r ' || echo "unknown")"
    curl -s "https://serverkit.ai/track/update?v=${new_version}" >/dev/null 2>&1 || true
    good "Cleanup complete"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
printf '\n  %s%sServerKit Updater%s\n' "$BLD" "$PAPER" "$RST"
STARTED_AT=$(date +%s)

[ "$DRY_RUN" = "1" ] && warn "DRY RUN — no changes will be made"

# If the update fails after we have switched the symlink, roll back to the
# previous slot automatically.
cleanup_on_exit() {
    local rc=$?
    [ "$rc" -eq 0 ] && return 0
    if [ "$DRY_RUN" = "0" ] && [ -n "${PREVIOUS_DIR:-}" ] && \
       [ "${ROLLING_BACK:-0}" != "1" ] && [ "${HEALTH_PASSED:-0}" != "1" ]; then
        ROLLING_BACK=1
        rollback
    fi
    return "$rc"
}
trap cleanup_on_exit EXIT

preflight_check
ensure_bluegreen_layout
backup_current

# Determine update mode.
NEXT_DIR="$(next_real_dir)"

if [ "$USE_RELEASE" = "1" ]; then
    if [ -z "$RELEASE_VERSION" ]; then
        RELEASE_VERSION="$(curl -sf "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
            | grep '"tag_name"' | head -1 | cut -d'"' -f4)"
        [ -n "$RELEASE_VERSION" ] || halt "Could not determine the latest release"
    fi
    step "Updating to release $RELEASE_VERSION"
    deploy_release "$NEXT_DIR" "$RELEASE_VERSION"
elif [ -n "$TARGET_BRANCH" ]; then
    step "Updating to branch $TARGET_BRANCH"
    deploy_source "$NEXT_DIR" "$TARGET_BRANCH"
else
    deploy_source "$NEXT_DIR" "main"
fi

# Ensure venv in the new tree.
require_venv "$NEXT_DIR/venv"

# Run database migrations before switching.
migrate_database "$NEXT_DIR"

# Sync templates.
if [ "$DRY_RUN" = "0" ]; then
    mkdir -p /etc/serverkit/templates
    cp -r "$NEXT_DIR/backend/templates/"*.yaml /etc/serverkit/templates/ 2>/dev/null || true
    cp -r "$NEXT_DIR/backend/templates/"*.yml  /etc/serverkit/templates/ 2>/dev/null || true
fi

# Build frontend if dist is missing (source mode or older release).
if [ ! -d "$NEXT_DIR/frontend/dist" ]; then
    step "Building frontend..."
    if [ "$DRY_RUN" = "0" ]; then
        cd "$NEXT_DIR/frontend"
        npm ci --prefer-offline 2>&1 | tail -3
        NODE_OPTIONS="--max-old-space-size=1024" npm run build 2>&1 | tail -5
    else
        info "[dry-run] would npm ci + npm run build in $NEXT_DIR/frontend"
    fi
fi

# Refresh nginx/systemd configs in the active tree before switch.
refresh_config "$NEXT_DIR"

# Stop services.
phase "Stopping Services"
run_or_dry systemctl stop "$BACKEND_SERVICE"
wait_for_service "$BACKEND_SERVICE" inactive 30 || warn "Backend did not stop within 30 seconds"
run_or_dry systemctl stop nginx
wait_for_service nginx inactive 15 || warn "nginx did not stop within 15 seconds"

# Record the currently active directory before switching.
PREVIOUS_DIR="$(active_real_dir)"

# Atomic switch.
atomic_switch "$NEXT_DIR"

# Start services.
phase "Starting Services"
run_or_dry systemctl start "$BACKEND_SERVICE"
wait_for_service "$BACKEND_SERVICE" active 30 || warn "Backend did not report active within 30 seconds"
run_or_dry cd "$INSTALL_DIR" && run_or_dry docker compose up -d --force-recreate frontend
run_or_dry docker compose up -d backend
run_or_dry systemctl start nginx
wait_for_service nginx active 15 || warn "nginx did not report active within 15 seconds"
good "Services started"

# Health check.
health_check

# Cleanup.
cleanup

# Summary.
printf '\n  %s%s✔  Update complete%s   %s%s%s\n\n' \
    "$BLD" "$HUE_OK" "$RST" "$FOG" "$(clock)" "$RST"
printf '  Version   %s\n' "$(cat "$INSTALL_DIR/VERSION" 2>/dev/null | tr -d '\n\r ' || echo "unknown")"
printf '  Active    %s\n' "$(active_real_dir)"
printf '  Backend   %s\n' "$(systemctl is-active serverkit 2>/dev/null || echo unknown)"
printf '  Nginx     %s\n\n' "$(systemctl is-active nginx 2>/dev/null || echo unknown)"
printf '  %sCLI%s       serverkit status\n\n' "$BLD" "$RST"
