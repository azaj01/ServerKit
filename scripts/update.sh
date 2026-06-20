#!/bin/bash
#
# ServerKit updater.
#
# Pulls the newest code (or release tarball), rebuilds, and restarts the
# stack while preserving the database, generated secrets, and .env. A failed
# health check rolls the previous tree back into place.
#
#   bash /opt/serverkit/scripts/update.sh
#   INSTALL_FROM_RELEASE=1 bash /opt/serverkit/scripts/update.sh
#   SERVERKIT_VERSION=v1.7.0 bash /opt/serverkit/scripts/update.sh
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Terminal styling (violet ServerKit identity, degrades to plain text)
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
# Settings
# ---------------------------------------------------------------------------
INSTALL_DIR="/opt/serverkit"
VENV_DIR="$INSTALL_DIR/venv"
BACKUP_DIR="/var/backups/serverkit"
GITHUB_REPO="${GITHUB_REPO:-jhd3197/ServerKit}"
INSTALL_FROM_RELEASE="${INSTALL_FROM_RELEASE:-0}"
BUILD_FROM_SOURCE="${BUILD_FROM_SOURCE:-0}"
SERVERKIT_VERSION="${SERVERKIT_VERSION:-}"
BACKEND_SERVICE="serverkit"

# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------
[ "$EUID" -eq 0 ]      || halt "Run as root."
[ -d "$INSTALL_DIR" ]  || halt "ServerKit is not installed at $INSTALL_DIR"

# ---------------------------------------------------------------------------
# Pick install mode: release tarball vs. source tree
# ---------------------------------------------------------------------------
if [ "$INSTALL_FROM_RELEASE" != "1" ] && [ ! -d "$INSTALL_DIR/backend/src" ]; then
    step "No source tree found — switching to release download."
    INSTALL_FROM_RELEASE=1
fi
[ "$BUILD_FROM_SOURCE" = "1" ] && INSTALL_FROM_RELEASE=0

# ---------------------------------------------------------------------------
# Self-refresh: replace this script with the release copy and re-exec, so an
# old updater can't drive a new release. Runs once (guarded by SELF_REFRESHED)
# and only in release mode. Kept inline so $@ / BASH_SOURCE resolve correctly.
# ---------------------------------------------------------------------------
if [ "${SELF_REFRESHED:-0}" != "1" ] && [ "$INSTALL_FROM_RELEASE" = "1" ] \
   && [ "${SERVERKIT_NO_SELF_REFRESH:-0}" != "1" ]; then
    newest_tag=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" 2>/dev/null \
        | grep -m1 '"tag_name"' | cut -d'"' -f4 || true)
    if [ -n "$newest_tag" ]; then
        upstream="https://raw.githubusercontent.com/${GITHUB_REPO}/${newest_tag}/scripts/update.sh"
        tmp=$(mktemp)
        if curl -fsSL "$upstream" -o "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
            if ! cmp -s "$tmp" "${BASH_SOURCE[0]}"; then
                step "Refreshing update.sh from $newest_tag..."
                cp "$tmp" "${BASH_SOURCE[0]}" 2>/dev/null || true
                rm -f "$tmp"
                export SELF_REFRESHED=1
                exec bash "${BASH_SOURCE[0]}" "$@"
            fi
        fi
        rm -f "$tmp"
    fi
fi

# ---------------------------------------------------------------------------
# Backfill the encryption key for installs that pre-date secrets-at-rest
# ---------------------------------------------------------------------------
backfill_encryption_key() {
    local env_file="$INSTALL_DIR/.env"
    if [ -f "$env_file" ] && ! grep -q '^SERVERKIT_ENCRYPTION_KEY=' "$env_file"; then
        step "Generating SERVERKIT_ENCRYPTION_KEY..."
        local key
        key=$(python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')
        echo "SERVERKIT_ENCRYPTION_KEY=$key" >> "$env_file"
        good "Encryption key added to $env_file"
    fi
}
backfill_encryption_key

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
printf '\n  %s%sServerKit Updater%s\n' "$BLD" "$PAPER" "$RST"
STARTED_AT=$(date +%s)

CURRENT_VERSION=$(cat "$INSTALL_DIR/VERSION" 2>/dev/null | tr -d '\n\r ' || echo "unknown")
step "Current version: $CURRENT_VERSION"

# ---------------------------------------------------------------------------
# Pull latest source (source-mode only)
# ---------------------------------------------------------------------------
if [ "$INSTALL_FROM_RELEASE" != "1" ] && [ -d "$INSTALL_DIR/.git" ]; then
    phase "Syncing Repository"
    cd "$INSTALL_DIR"
    git stash -q 2>/dev/null || true
    if git fetch --depth=1 origin main 2>/dev/null; then
        git reset --hard FETCH_HEAD 2>&1 | tail -1
        good "Repository synced to origin/main"
    else
        warn "Repo sync failed — keeping the existing source."
    fi
fi

# ---------------------------------------------------------------------------
# Back up database + install tree
# ---------------------------------------------------------------------------
phase "Database Backup"
mkdir -p "$BACKUP_DIR"

DB_FILE="$INSTALL_DIR/backend/instance/serverkit.db"
if [ -f "$DB_FILE" ]; then
    BACKUP_FILE="$BACKUP_DIR/serverkit-pre-upgrade-$(date +%Y%m%d-%H%M%S).db"
    if cp "$DB_FILE" "$BACKUP_FILE"; then
        good "Database backed up to $BACKUP_FILE"
    else
        halt "Database backup failed — aborting upgrade."
    fi
else
    warn "No SQLite database at $DB_FILE — skipping DB backup."
fi

BACKUP_TREE="$BACKUP_DIR/serverkit-tree-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_TREE"
rsync -a --exclude=venv --exclude=backups --exclude=node_modules \
    "$INSTALL_DIR/" "$BACKUP_TREE/" 2>/dev/null || \
    cp -a "$INSTALL_DIR" "$BACKUP_TREE" 2>/dev/null || true
good "Install tree backed up."

# ---------------------------------------------------------------------------
# Stop the stack
# ---------------------------------------------------------------------------
phase "Stopping Services"
systemctl stop "$BACKEND_SERVICE" 2>/dev/null || true
systemctl stop nginx 2>/dev/null || true

# ---------------------------------------------------------------------------
# Deploy: download a release, or rebuild from source
# ---------------------------------------------------------------------------
if [ "$INSTALL_FROM_RELEASE" = "1" ]; then
    phase "Downloading Release"

    case "$(uname -m)" in
        x86_64)        DL_ARCH="amd64" ;;
        aarch64|arm64) DL_ARCH="arm64" ;;
        *)             halt "Unsupported architecture: $(uname -m)" ;;
    esac

    if [ -n "$SERVERKIT_VERSION" ]; then
        RELEASE_TAG="$SERVERKIT_VERSION"
        step "Pinned release: $RELEASE_TAG"
    else
        step "Looking up the latest release..."
        RELEASE_TAG=$(curl -sf "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
            | grep '"tag_name"' | head -1 | cut -d'"' -f4)
        [ -n "$RELEASE_TAG" ] || halt "Could not determine the latest release."
        good "Latest release: $RELEASE_TAG"
    fi

    BASE_URL="https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}"
    TARBALL="/tmp/serverkit-${RELEASE_TAG}-linux-${DL_ARCH}.tar.gz"

    step "Downloading release tarball (${DL_ARCH})..."
    curl -sfL "${BASE_URL}/serverkit-${RELEASE_TAG}-linux-${DL_ARCH}.tar.gz" -o "$TARBALL" \
        || halt "Failed to download the release tarball."

    step "Unpacking release..."
    STAGE="/tmp/serverkit-release-$$"
    rm -rf "$STAGE"
    mkdir -p "$STAGE"
    tar xzf "$TARBALL" -C "$STAGE"
    rm -f "$TARBALL"

    # Carry the live .env and database across.
    cp "$INSTALL_DIR/.env" "$STAGE/serverkit/.env" 2>/dev/null || true
    cp "$INSTALL_DIR/backend/instance/serverkit.db" \
        "$STAGE/serverkit/backend/instance/serverkit.db" 2>/dev/null || true

    mv "$INSTALL_DIR" "$INSTALL_DIR.old"
    mv "$STAGE/serverkit" "$INSTALL_DIR"
    rm -rf "$STAGE"
    good "Release deployed."
else
    phase "Updating Source"
    cd "$INSTALL_DIR"

    chmod +x "$INSTALL_DIR/serverkit"
    chmod +x "$INSTALL_DIR/scripts/"*.sh 2>/dev/null || true

    step "Updating Python dependencies..."
    source "$VENV_DIR/bin/activate"
    pip install -r "$INSTALL_DIR/backend/requirements.txt" --quiet

    step "Syncing app templates..."
    mkdir -p /etc/serverkit/templates
    cp -r "$INSTALL_DIR/backend/templates/"*.yaml /etc/serverkit/templates/ 2>/dev/null || true
    cp -r "$INSTALL_DIR/backend/templates/"*.yml  /etc/serverkit/templates/ 2>/dev/null || true

    step "Rebuilding the frontend..."
    cd "$INSTALL_DIR/frontend"
    npm ci --prefer-offline 2>&1 | tail -3
    NODE_OPTIONS="--max-old-space-size=1024" npm run build 2>&1 | tail -5

    step "Rebuilding the frontend container..."
    cd "$INSTALL_DIR"
    docker compose build 2>&1 | tail -5
    good "Source updated."
fi

# ---------------------------------------------------------------------------
# Refresh nginx + systemd from the new tree
# ---------------------------------------------------------------------------
phase "Refreshing Configuration"

# Recover the panel domain baked into the *current* live config before we
# overwrite it -- older installs predate /etc/serverkit/panel-domain.
PRIOR_PANEL_DOMAIN=$(grep -oE '/etc/letsencrypt/live/[^/]+/' \
    /etc/nginx/sites-available/serverkit.conf 2>/dev/null | head -n1 | \
    sed -E 's|.*/live/([^/]+)/|\1|')
[ "$PRIOR_PANEL_DOMAIN" = "YOUR_DOMAIN" ] && PRIOR_PANEL_DOMAIN=""

if [ -f "$INSTALL_DIR/nginx/sites-available/serverkit.conf" ]; then
    cp "$INSTALL_DIR/nginx/sites-available/serverkit.conf" /etc/nginx/sites-available/
fi
if [ -f "$INSTALL_DIR/nginx/sites-available/serverkit-insecure.conf" ]; then
    cp "$INSTALL_DIR/nginx/sites-available/serverkit-insecure.conf" /etc/nginx/sites-available/
fi

# Re-apply the server-wide TLS floor (TLS 1.2/1.3 + AEAD ciphers) so existing
# installs get hardened on update too, not just fresh installs.
if [ -f /etc/nginx/nginx.conf ]; then
    SK_CIPHERS='ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384'
    if grep -qE '^[[:space:]]*ssl_protocols[[:space:]]' /etc/nginx/nginx.conf; then
        sed -i -E 's|^([[:space:]]*)ssl_protocols[[:space:]].*|\1ssl_protocols TLSv1.2 TLSv1.3;|' /etc/nginx/nginx.conf
    else
        sed -i '/http {/a \    ssl_protocols TLSv1.2 TLSv1.3;' /etc/nginx/nginx.conf
    fi
    if grep -qE '^[[:space:]]*ssl_ciphers[[:space:]]' /etc/nginx/nginx.conf; then
        sed -i -E "s|^([[:space:]]*)ssl_ciphers[[:space:]].*|\1ssl_ciphers ${SK_CIPHERS};|" /etc/nginx/nginx.conf
    else
        sed -i "/http {/a \\    ssl_ciphers ${SK_CIPHERS};" /etc/nginx/nginx.conf
    fi
fi

# Preserve the user's secure/insecure SSL choice across updates.
SSL_MODE="insecure"
if [ -f /etc/serverkit/ssl-mode ]; then
    SSL_MODE=$(cat /etc/serverkit/ssl-mode)
fi
if [ "$SSL_MODE" = "secure" ] && [ -f /etc/nginx/sites-available/serverkit.conf ]; then
    # Recover the panel domain: prefer the value install.sh persisted, then the
    # one scraped from the prior live config above. (The old .env scrape was
    # broken -- SERVERKIT_PUBLIC_URL is written commented out.)
    PANEL_DOMAIN="${PANEL_DOMAIN:-}"
    if [ -z "$PANEL_DOMAIN" ] && [ -f /etc/serverkit/panel-domain ]; then
        PANEL_DOMAIN=$(cat /etc/serverkit/panel-domain 2>/dev/null || true)
    fi
    [ -z "$PANEL_DOMAIN" ] && PANEL_DOMAIN="$PRIOR_PANEL_DOMAIN"

    if [ -n "$PANEL_DOMAIN" ] && [ -d "/etc/letsencrypt/live/$PANEL_DOMAIN" ]; then
        sed -i "s|/etc/letsencrypt/live/YOUR_DOMAIN/|/etc/letsencrypt/live/$PANEL_DOMAIN/|g" \
            /etc/nginx/sites-available/serverkit.conf
        ln -sf /etc/nginx/sites-available/serverkit.conf /etc/nginx/sites-enabled/serverkit.conf
    else
        warn "SSL mode is 'secure' but no certificate was found for '${PANEL_DOMAIN:-unknown}'."
        warn "Using the HTTP config so nginx still reloads. Re-run certbot to restore HTTPS."
        ln -sf /etc/nginx/sites-available/serverkit-insecure.conf /etc/nginx/sites-enabled/serverkit.conf
    fi
else
    ln -sf /etc/nginx/sites-available/serverkit-insecure.conf /etc/nginx/sites-enabled/serverkit.conf
fi

mkdir -p /etc/nginx/serverkit-locations
for conf in /etc/nginx/sites-enabled/*; do
    [ -f "$conf" ] || continue
    name=$(basename "$conf")
    case "$name" in serverkit-*) continue ;; esac
    if grep -Eq 'server_name[[:space:]]+_;' "$conf" 2>/dev/null; then
        warn "Removing conflicting catch-all config: $name"
        rm -f "/etc/nginx/sites-enabled/$name" "/etc/nginx/sites-available/$name"
    fi
done

if [ -f "$INSTALL_DIR/serverkit-backend.service" ]; then
    cp "$INSTALL_DIR/serverkit-backend.service" /etc/systemd/system/serverkit.service
fi
systemctl daemon-reload
good "Configuration refreshed."

# ---------------------------------------------------------------------------
# Bring the stack back up
# ---------------------------------------------------------------------------
phase "Starting Services"
systemctl start "$BACKEND_SERVICE"
cd "$INSTALL_DIR"
docker compose up -d 2>&1 | tail -5
systemctl start nginx
good "Services started."

# ---------------------------------------------------------------------------
# Health check; restore the previous tree on failure
# ---------------------------------------------------------------------------
phase "Health Check"

roll_back() {
    warn "Health check failed — rolling back..."
    systemctl stop "$BACKEND_SERVICE" 2>/dev/null || true
    systemctl stop nginx 2>/dev/null || true
    if [ -d "$INSTALL_DIR.old" ]; then
        rm -rf "$INSTALL_DIR"
        mv "$INSTALL_DIR.old" "$INSTALL_DIR"
        warn "Restored the previous installation from $INSTALL_DIR.old"
    fi
    systemctl daemon-reload
    systemctl start "$BACKEND_SERVICE" 2>/dev/null || true
    systemctl start nginx 2>/dev/null || true
    halt "Update rolled back. Inspect logs: journalctl -u serverkit -n 50"
}

step "Waiting for the backend to answer..."
WAITED=0
while [ "$WAITED" -lt 30 ]; do
    if curl -sf --max-time 5 http://127.0.0.1:5000/api/v1/system/health >/dev/null 2>&1; then
        good "Backend healthy."
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
done
[ "$WAITED" -ge 30 ] && roll_back

# Second probe as a belt-and-suspenders gate before we discard the old tree.
curl -sf --max-time 5 http://127.0.0.1:5000/api/v1/system/health >/dev/null 2>&1 || roll_back

# ---------------------------------------------------------------------------
# Cleanup + telemetry
# ---------------------------------------------------------------------------
phase "Cleanup"

[ -d "$INSTALL_DIR.old" ] && rm -rf "$INSTALL_DIR.old"

# Keep only the 10 most recent backups of each kind.
ls -t "$BACKUP_DIR"/serverkit-tree-*          2>/dev/null | tail -n +11 | xargs -r rm -rf
ls -t "$BACKUP_DIR"/serverkit-pre-upgrade-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f

NEW_VERSION=$(cat "$INSTALL_DIR/VERSION" 2>/dev/null | tr -d '\n\r ' || echo "unknown")
curl -s "https://serverkit.ai/track/update?v=${NEW_VERSION}" >/dev/null 2>&1 || true
good "Cleanup complete."

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n  %s%s✔  Update complete%s   %s%s%s\n\n' \
    "$BLD" "$HUE_OK" "$RST" "$FOG" "$(clock)" "$RST"
printf '  Version   %s\n' "$NEW_VERSION"
printf '  Backend   %s\n' "$(systemctl is-active serverkit)"
printf '  Nginx     %s\n\n' "$(systemctl is-active nginx)"
printf '  %sCLI%s       serverkit status\n\n' "$BLD" "$RST"
