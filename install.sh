#!/bin/bash
#
# ServerKit bootstrap installer.
#
#   curl -fsSL https://serverkit.ai/install.sh | bash
#
# By default the script clones the repository and builds from source. Two
# environment switches change that:
#
#   INSTALL_FROM_RELEASE=1   fetch a pre-built tarball instead of compiling
#   BUILD_FROM_SOURCE=1      force a source build even when a release exists
#   SERVERKIT_SKIP_SSL=1     run on plain HTTP (no HTTPS / no certbot attempt)
#
# The Flask backend runs straight on the host (it needs real system access);
# the React frontend is built to static files and served by the host nginx.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Settings and environment contract
# ---------------------------------------------------------------------------
INSTALL_DIR="/opt/serverkit"
VENV_DIR="$INSTALL_DIR/venv"
LOG_DIR="/var/log/serverkit"
DATA_DIR="/var/lib/serverkit"
BACKUP_DIR="/var/backups/serverkit"
CONFIG_DIR="/etc/serverkit"

PYTHON_MIN="3.11"
PYTHON_MAX="3.12"
PYTHON_BIN=""

GITHUB_REPO="${GITHUB_REPO:-jhd3197/ServerKit}"
INSTALL_FROM_RELEASE="${INSTALL_FROM_RELEASE:-0}"
BUILD_FROM_SOURCE="${BUILD_FROM_SOURCE:-0}"
SERVERKIT_VERSION="${SERVERKIT_VERSION:-}"
VERSION="${VERSION:-${SERVERKIT_VERSION:-1.4.11}}"
CHANNEL="${CHANNEL:-Stable}"

PANEL_DOMAIN="${PANEL_DOMAIN:-}"
PANEL_PORT="${PANEL_PORT:-80}"
SERVERKIT_SKIP_SSL="${SERVERKIT_SKIP_SSL:-0}"

# Runtime state populated as we go (declared up-front for `set -u`).
OS_FAMILY="unknown"
ARCH=""
DL_ARCH=""
PKG_MGR=""
SAFE_MODE=false
SSL_MODE="insecure"

# ---------------------------------------------------------------------------
# Terminal styling
#
# Truecolor is used when the stream is an interactive terminal that has not
# opted out. The ServerKit identity is a violet ramp (V1 brightest .. V5
# deepest); status colors sit alongside it. Everything degrades to plain text
# when colour is unavailable so piped logs stay readable.
# ---------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
    ESC=$'\033'
    RST="${ESC}[0m"; BLD="${ESC}[1m"; DIMM="${ESC}[2m"
    paint() { printf '%s[38;2;%d;%d;%dm' "$ESC" "$1" "$2" "$3"; }
else
    RST=''; BLD=''; DIMM=''
    paint() { :; }
fi

V1="$(paint 196 181 253)"; V2="$(paint 167 139 250)"; V3="$(paint 139 92 246)"
V4="$(paint 124 58 237)";  V5="$(paint 109 40 217)"
PAPER="$(paint 237 233 254)"; ASH="$(paint 165 160 190)"; FOG="$(paint 113 108 140)"
HUE_OK="$(paint 52 211 153)"; HUE_WARN="$(paint 250 204 21)"
HUE_ERR="$(paint 248 113 113)"; HUE_LINK="$(paint 103 232 249)"

# Line-level reporting. Distinct verbs, distinct marks, single indent.
good()  { printf '  %s✔%s %s\n'  "$HUE_OK"   "$RST" "$1"; }
warn()  { printf '  %s▴%s %s\n'  "$HUE_WARN" "$RST" "$1"; }
halt()  { printf '  %s✘%s %s\n'  "$HUE_ERR"  "$RST" "$1" >&2; exit 1; }
step()  { printf '  %s❯%s %s\n'  "$HUE_LINK" "$RST" "$1"; }
faint() { printf '  %s%s%s\n'    "$FOG" "$1" "$RST"; }

# ---------------------------------------------------------------------------
# Phase headers
#
# Each major stage prints a numbered, time-stamped header followed by a violet
# rule. There is no global step total — the index plus elapsed clock is enough
# to read progress, and it never drifts out of sync with the actual path taken
# (source vs. release installs run different stages).
# ---------------------------------------------------------------------------
STARTED_AT=0
PHASE_N=0

clock() {
    [ "$STARTED_AT" -gt 0 ] || { printf ''; return; }
    local secs=$(( $(date +%s) - STARTED_AT ))
    printf '%dm %02ds' "$((secs / 60))" "$((secs % 60))"
}

phase() {
    PHASE_N=$((PHASE_N + 1))
    local t; t="$(clock)"
    printf '\n  %s%s%02d%s  %s%s%s  %s%s%s\n' \
        "$BLD" "$V3" "$PHASE_N" "$RST" "$BLD" "$1" "$RST" "$FOG" "$t" "$RST"
    printf '  %s%s%s\n\n' "$V4" "──────────────────────────────────────" "$RST"
}

# ---------------------------------------------------------------------------
# Masthead
# ---------------------------------------------------------------------------
masthead() {
    printf '\n'
    printf '  %s%s▖▌▌%s  %s%sServerKit%s  %sv%s%s  %s•%s %s%s%s\n' \
        "$BLD" "$V2" "$RST" "$BLD" "$PAPER" "$RST" "$FOG" "$VERSION" "$RST" \
        "$HUE_OK" "$RST" "$ASH" "$CHANNEL" "$RST"
    printf '  %s%s▌▖▌%s  %sSelf-hosted infrastructure, made simple.%s\n' \
        "$BLD" "$V3" "$RST" "$ASH" "$RST"
    printf '  %s%s▌▌▖%s  %sWeb apps · Databases · Docker · Email · DNS · Security%s\n' \
        "$BLD" "$V4" "$RST" "$FOG" "$RST"
    printf '  %s%s▘▘▘%s  %sPython + React, one command · serverkit.ai%s\n' \
        "$BLD" "$V5" "$RST" "$FOG" "$RST"
    printf '\n'
}

# ---------------------------------------------------------------------------
# Pre-flight: disk, memory, privileges
# ---------------------------------------------------------------------------
preflight() {
    step "Running pre-flight checks..."

    # Source builds need more headroom than unpacking a release.
    local need_kb=5242880
    [ "$INSTALL_FROM_RELEASE" = "1" ] && need_kb=2097152

    local free_kb
    free_kb=$(df /opt 2>/dev/null | awk 'NR==2 {print $4}')
    if [ -n "$free_kb" ] && [ "$free_kb" -lt "$need_kb" ]; then
        halt "Need at least $((need_kb / 1024 / 1024))GB free on /opt; less is available."
    fi

    local free_mem
    free_mem=$(free -m | awk '/^Mem:/ {print $7}')
    if [ -n "$free_mem" ] && [ "$free_mem" -lt 256 ]; then
        warn "Under 256MB memory free — the install may run slowly."
    fi

    if [ "$EUID" -ne 0 ]; then
        halt "Please run this installer as root (use sudo)."
    fi

    good "Pre-flight checks passed."
}

# ---------------------------------------------------------------------------
# Identify the OS family and CPU architecture
# ---------------------------------------------------------------------------
identify_system() {
    phase "Detecting System"

    [ -f /etc/os-release ] || halt "Cannot detect OS — /etc/os-release is missing."
    . /etc/os-release

    case "${ID:-}" in
        ubuntu|debian)
            OS_FAMILY="debian";  good "Detected: $PRETTY_NAME" ;;
        fedora)
            OS_FAMILY="fedora";  good "Detected: $PRETTY_NAME" ;;
        rocky|almalinux|rhel|centos)
            OS_FAMILY="rhel";    good "Detected: $PRETTY_NAME (RHEL family)" ;;
        *)
            warn "Untested OS '${ID:-unknown}' — continuing anyway." ;;
    esac

    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)          DL_ARCH="amd64"; good "Architecture: x86_64" ;;
        aarch64|arm64)   DL_ARCH="arm64"; good "Architecture: ARM64" ;;
        *)               halt "Unsupported architecture: $ARCH" ;;
    esac
}

# ---------------------------------------------------------------------------
# Package manager abstraction (apt / dnf / yum)
# ---------------------------------------------------------------------------
choose_pkg_manager() {
    if command -v apt-get &>/dev/null; then
        PKG_MGR="apt"
        # unattended-upgrades can hold the dpkg lock right after boot; tell
        # apt to wait for it rather than failing outright.
        mkdir -p /etc/apt/apt.conf.d
        cat > /etc/apt/apt.conf.d/99-serverkit-lock-wait.conf <<'APT_EOF'
DPkg::Lock::Timeout "300";
APT_EOF
    elif command -v dnf &>/dev/null; then
        PKG_MGR="dnf"
    elif command -v yum &>/dev/null; then
        PKG_MGR="yum"
    else
        halt "No supported package manager found (need apt, dnf, or yum)."
    fi
}

refresh_pkg_index() {
    case "$PKG_MGR" in
        apt) apt-get update -y >/dev/null 2>&1 ;;
        dnf) dnf makecache --refresh >/dev/null 2>&1 ;;
        yum) yum makecache --refresh >/dev/null 2>&1 ;;
    esac
}

pkg_add() {
    local out rc
    case "$PKG_MGR" in
        apt) out=$(apt-get install -y "$@" 2>&1) ;;
        dnf) out=$(dnf install -y "$@" 2>&1) ;;
        yum) out=$(yum install -y "$@" 2>&1) ;;
    esac
    rc=$?
    if [ $rc -ne 0 ]; then
        warn "Could not install: $* (exit $rc)"
        printf '%s\n' "$out" | tail -5 >&2
        return $rc
    fi
}

# ---------------------------------------------------------------------------
# Memory tuning: low-RAM safe mode and a swap fallback
# ---------------------------------------------------------------------------
gauge_memory() {
    local total
    total=$(free -m | awk '/^Mem:/ {print $2}')
    if [ "$total" -le 700 ]; then
        SAFE_MODE=true
        warn "Low RAM (${total}MB) — enabling VPS safe mode."
    else
        SAFE_MODE=false
    fi
}

ensure_swap() {
    local swap
    swap=$(free -m | awk '/^Swap:/ {print $2}')
    if [ "$swap" -lt 512 ]; then
        step "Adding 1GB of swap..."
        if [ ! -f /swapfile ]; then
            fallocate -l 1G /swapfile 2>/dev/null || \
                dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
            chmod 600 /swapfile
            mkswap /swapfile >/dev/null
        fi
        swapon /swapfile 2>/dev/null || true
        good "Swap active."
    fi
}

# ---------------------------------------------------------------------------
# Python 3.11/3.12 — detect a usable interpreter or build one
# ---------------------------------------------------------------------------
ver_in_range() {
    # true when $1 is >= PYTHON_MIN and <= PYTHON_MAX
    printf '%s\n%s' "$PYTHON_MIN" "$1" | sort -C -V && \
    printf '%s\n%s' "$1" "$PYTHON_MAX" | sort -C -V
}

locate_python() {
    if command -v python3 &>/dev/null; then
        local v
        v=$(python3 -c 'import sys;print(".".join(map(str,sys.version_info[:2])))')
        if ver_in_range "$v"; then
            PYTHON_BIN="python3"
            good "Using system Python $v"
            return
        fi
    fi
    warn "System Python is outside the supported $PYTHON_MIN–$PYTHON_MAX range."
}

build_python_from_source() {
    cd /tmp
    wget -q https://www.python.org/ftp/python/3.12.8/Python-3.12.8.tgz
    tar xzf Python-3.12.8.tgz
    cd Python-3.12.8
    ./configure --enable-optimizations --prefix=/usr/local 2>&1 | tail -1
    make -j"$(nproc)" 2>&1 | tail -1
    make altinstall 2>&1 | tail -1
    cd /tmp && rm -rf Python-3.12.8 Python-3.12.8.tgz
}

provision_python() {
    phase "Installing Python"

    locate_python
    [ -n "$PYTHON_BIN" ] && return

    step "Installing Python 3.12..."
    if [ "$OS_FAMILY" = "debian" ]; then
        if [ "$ID" = "ubuntu" ]; then
            pkg_add software-properties-common
            add-apt-repository -y ppa:deadsnakes/ppa
            refresh_pkg_index
            pkg_add python3.12 python3.12-venv python3.12-dev
        else
            step "Compiling Python 3.12 from source (a few minutes)..."
            pkg_add wget zlib1g-dev libbz2-dev libreadline-dev \
                libsqlite3-dev libncurses5-dev libncursesw5-dev \
                xz-utils tk-dev liblzma-dev libffi-dev libssl-dev
            build_python_from_source
        fi
        PYTHON_BIN="python3.12"
    elif [ "$OS_FAMILY" = "fedora" ] || [ "$OS_FAMILY" = "rhel" ]; then
        if ! pkg_add python3.12 python3.12-devel; then
            step "Compiling Python 3.12 from source (a few minutes)..."
            pkg_add wget zlib-devel bzip2-devel readline-devel \
                sqlite-devel ncurses-devel xz-devel tk-devel libffi-devel
            build_python_from_source
        fi
        PYTHON_BIN="python3.12"
    fi

    command -v "$PYTHON_BIN" &>/dev/null || \
        halt "Could not install Python 3.12 — install Python 3.11 or 3.12 by hand."
    good "Python 3.12 installed."
}

# ---------------------------------------------------------------------------
# Docker engine + compose plugin
# ---------------------------------------------------------------------------
provision_docker() {
    phase "Docker"

    if command -v docker &>/dev/null; then
        good "Docker already present: $(docker --version | head -1)"
        return
    fi

    step "Installing Docker..."
    case "$OS_FAMILY" in
        fedora)
            pkg_add dnf-plugins-core
            dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
            pkg_add docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin
            ;;
        rhel)
            pkg_add dnf-plugins-core
            dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
            pkg_add docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin
            ;;
        *)
            curl -fsSL https://get.docker.com | sh
            ;;
    esac

    systemctl enable docker
    systemctl start docker
    good "Docker installed."
}

ensure_compose_plugin() {
    if docker compose version &>/dev/null; then
        good "Docker Compose plugin present."
        return
    fi
    step "Installing Docker Compose plugin..."
    pkg_add docker-compose-plugin
    good "Docker Compose plugin installed."
}

# ---------------------------------------------------------------------------
# Node.js 20 (only needed for source builds — releases ship a built frontend)
# ---------------------------------------------------------------------------
provision_node() {
    phase "Node.js"

    if [ "$INSTALL_FROM_RELEASE" = "1" ]; then
        good "Skipping Node.js — the release ships a pre-built frontend."
        return
    fi

    if command -v node &>/dev/null; then
        good "Node.js already present: $(node --version)"
        return
    fi

    step "Installing Node.js 20 LTS..."
    if [ "$OS_FAMILY" = "debian" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    else
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    fi
    pkg_add nodejs
    good "Node.js $(node --version) installed."
}

# ---------------------------------------------------------------------------
# Release tarball path
# ---------------------------------------------------------------------------
resolve_release_tag() {
    if [ -n "$SERVERKIT_VERSION" ]; then
        printf '%s' "$SERVERKIT_VERSION"
        return
    fi
    curl -sf "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
        | grep '"tag_name"' | head -1 | cut -d'"' -f4
}

fetch_release() {
    phase "Downloading Pre-built Release"

    local tag; tag=$(resolve_release_tag)
    if [ -z "$tag" ]; then
        warn "Latest release tag unknown — falling back to a source build."
        INSTALL_FROM_RELEASE=0
        return 1
    fi
    good "Latest release: $tag"

    local base="https://github.com/${GITHUB_REPO}/releases/download/${tag}"
    local tarball="/tmp/serverkit-${tag}-linux-${DL_ARCH}.tar.gz"

    step "Fetching release tarball (${DL_ARCH})..."
    if ! curl -sfL "${base}/serverkit-${tag}-linux-${DL_ARCH}.tar.gz" -o "$tarball"; then
        warn "No release tarball for this platform — falling back to source."
        INSTALL_FROM_RELEASE=0
        return 1
    fi

    step "Unpacking release..."
    rm -rf "$INSTALL_DIR"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    tar xzf "$tarball" -C "$(dirname "$INSTALL_DIR")"
    rm -f "$tarball"
    good "Release unpacked into $INSTALL_DIR"
}

# ---------------------------------------------------------------------------
# Source path: fetch / refresh the repository
# ---------------------------------------------------------------------------
sync_source() {
    phase "Source Code"

    if [ -d "$INSTALL_DIR/.git" ]; then
        step "Refreshing the existing checkout..."
        cd "$INSTALL_DIR"
        if ! git pull --ff-only; then
            warn "Fast-forward failed (local edits?) — hard-resetting to origin/main."
            git fetch origin
            git reset --hard origin/main
        fi
    else
        step "Cloning ServerKit..."
        rm -rf "$INSTALL_DIR"
        git clone --depth 1 "https://github.com/${GITHUB_REPO}.git" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    good "Repository ready."
}

# ---------------------------------------------------------------------------
# On-disk layout
# ---------------------------------------------------------------------------
make_directories() {
    phase "Creating Directories"

    local d
    for d in "$LOG_DIR" "$DATA_DIR" "$BACKUP_DIR" "$CONFIG_DIR" "$INSTALL_DIR/backend/instance"; do
        mkdir -p -m 0750 "$d"
    done
    for d in "$INSTALL_DIR/nginx/ssl" /etc/serverkit/templates /var/serverkit/apps \
             /var/www/acme /etc/nginx/serverkit-locations; do
        mkdir -p -m 0755 "$d"
    done

    good "Directories created."
}

# ---------------------------------------------------------------------------
# Python virtual environment + dependencies
# ---------------------------------------------------------------------------
build_virtualenv() {
    phase "Python Environment"

    step "Creating the virtual environment..."
    $PYTHON_BIN -m venv "$VENV_DIR"
    source "$VENV_DIR/bin/activate"

    step "Installing Python dependencies..."
    pip install --upgrade pip --quiet
    if [ "$SAFE_MODE" = true ]; then
        pip install --no-cache-dir -r "$INSTALL_DIR/backend/requirements.txt" --quiet
    else
        pip install -r "$INSTALL_DIR/backend/requirements.txt" --quiet
    fi
    pip install gunicorn gevent gevent-websocket --quiet

    good "Python environment ready."
}

# ---------------------------------------------------------------------------
# Application configuration and generated secrets
# ---------------------------------------------------------------------------
write_config() {
    phase "Configuration"

    if [ -f "$INSTALL_DIR/.env" ]; then
        warn ".env already exists — leaving the current configuration in place."
        return
    fi

    step "Generating configuration..."
    local secret_key jwt_secret encryption_key
    secret_key=$(openssl rand -hex 32)
    jwt_secret=$(openssl rand -hex 32)
    encryption_key=$(python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')

    # Widen CORS / advertise a public URL when a panel domain is known.
    local public_url="" cors_origins="http://localhost,https://localhost"
    local url_scheme="http"
    if [ -n "$PANEL_DOMAIN" ]; then
        if [ "$SSL_MODE" = "secure" ]; then
            url_scheme="https"
            cors_origins="http://localhost,https://localhost,https://$PANEL_DOMAIN"
        else
            url_scheme="http"
            cors_origins="http://localhost,https://localhost,http://$PANEL_DOMAIN"
        fi
        public_url="${url_scheme}://$PANEL_DOMAIN"
    fi

    cat > "$INSTALL_DIR/.env" <<EOF
# ServerKit Configuration
# Generated on $(date)

# Security Keys (auto-generated, keep secret!)
SECRET_KEY=$secret_key
JWT_SECRET_KEY=$jwt_secret
SERVERKIT_ENCRYPTION_KEY=$encryption_key

# Database (SQLite by default)
DATABASE_URL=sqlite:///$INSTALL_DIR/backend/instance/serverkit.db

# CORS Origins (comma-separated, add your domain)
CORS_ORIGINS=$cors_origins

# Public URL for agents and install commands (optional)
${public_url:+# SERVERKIT_PUBLIC_URL=$public_url}

# SSL mode (secure|insecure) — gates the panel's HSTS header so HTTPS stays
# optional. Mirrors /etc/serverkit/ssl-mode; set to 'secure' only when this
# server terminates real end-to-end HTTPS.
SERVERKIT_SSL_MODE=$SSL_MODE

# Ports
PORT=80
SSL_PORT=443

# Environment
FLASK_ENV=production
EOF
    chmod 600 "$INSTALL_DIR/.env"
    good "Configuration generated."

    # When a domain is configured, bounce bare-IP visitors to it.
    if [ -n "$PANEL_DOMAIN" ]; then
        mkdir -p /etc/nginx/serverkit-conf.d
        cat > /etc/nginx/serverkit-conf.d/canonical-domain.conf <<EOF
# Auto-generated by ServerKit install.sh
# Redirect direct IP access to the canonical panel domain.
server {
    listen 80 default_server;
    server_name _;
    if (\$host ~* ^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+\$) {
        return 301 ${url_scheme}://$PANEL_DOMAIN\$request_uri;
    }
}
EOF
        good "Canonical-domain redirect configured for $PANEL_DOMAIN"
    fi
}

# ---------------------------------------------------------------------------
# Frontend build (skipped on release installs)
# ---------------------------------------------------------------------------
build_frontend() {
    phase "Frontend Build"

    if [ "$INSTALL_FROM_RELEASE" = "1" ]; then
        good "Using the pre-built frontend from the release."
        return
    fi

    step "Installing npm packages..."
    cd "$INSTALL_DIR/frontend"
    npm ci --prefer-offline 2>&1 | tail -3

    step "Compiling the frontend bundle..."
    NODE_OPTIONS="--max-old-space-size=1024" npm run build 2>&1 | tail -5
    good "Frontend built."
}

# ---------------------------------------------------------------------------
# nginx site + reverse-proxy wiring
# ---------------------------------------------------------------------------
configure_nginx() {
    phase "Nginx"

    if command -v nginx &>/dev/null; then
        good "Nginx already installed."
    else
        step "Installing Nginx..."
        pkg_add nginx
        systemctl enable nginx
        good "Nginx installed."
    fi

    systemctl stop nginx 2>/dev/null || true
    rm -f /etc/nginx/sites-enabled/default

    mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/serverkit-conf.d /var/www/certbot

    # Fedora/RHEL nginx.conf doesn't include sites-enabled by default.
    if ! grep -q "sites-enabled" /etc/nginx/nginx.conf; then
        sed -i '/http {/a \    include /etc/nginx/sites-enabled/*;' /etc/nginx/nginx.conf
    fi

    # Server-wide TLS floor: harden ssl_protocols/ssl_ciphers in the main
    # nginx.conf so even the default server and vhosts ServerKit did not
    # generate cannot negotiate TLS 1.0/1.1 or weak ciphers.
    harden_global_tls

    # Drop any foreign catch-all vhost that would shadow the panel.
    for conf in /etc/nginx/sites-enabled/*; do
        [ -f "$conf" ] || continue
        local name; name=$(basename "$conf")
        case "$name" in serverkit-*|serverkit.conf) continue ;; esac
        if grep -Eq 'server_name[[:space:]]+_;' "$conf" 2>/dev/null; then
            warn "Removing conflicting catch-all vhost: $name"
            rm -f "/etc/nginx/sites-enabled/$name" "/etc/nginx/sites-available/$name"
        fi
    done

    cp "$INSTALL_DIR/nginx/sites-available/serverkit.conf" /etc/nginx/sites-available/
    cp "$INSTALL_DIR/nginx/sites-available/serverkit-insecure.conf" /etc/nginx/sites-available/
    cp "$INSTALL_DIR/nginx/sites-available/example.conf.template" /etc/nginx/sites-available/

    # Decide whether we can use HTTPS. SSL is best-effort: if certbot fails or
    # no domain is given, we fall back to plain HTTP rather than forcing the
    # user to fix DNS/certs before they can use ServerKit.
    choose_ssl_mode
    install_nginx_config_for_mode

    # SELinux: let nginx make upstream connections to the app containers.
    if { [ "$OS_FAMILY" = "fedora" ] || [ "$OS_FAMILY" = "rhel" ]; } && command -v setsebool &>/dev/null; then
        setsebool -P httpd_can_network_connect 1 2>/dev/null || true
    fi

    good "Nginx configured ($SSL_MODE)."
}

# ---------------------------------------------------------------------------
# Choose secure or insecure mode. Never block the install because of SSL.
# ---------------------------------------------------------------------------
choose_ssl_mode() {
    if [ "$SERVERKIT_SKIP_SSL" = "1" ]; then
        SSL_MODE="insecure"
        warn "SERVERKIT_SKIP_SSL=1 — using plain HTTP."
        return
    fi

    if [ -z "$PANEL_DOMAIN" ]; then
        SSL_MODE="insecure"
        warn "No panel domain provided — using plain HTTP (access by IP)."
        warn "Set PANEL_DOMAIN and re-run the installer to try HTTPS automatically."
        return
    fi

    if ! command -v certbot &>/dev/null; then
        SSL_MODE="insecure"
        warn "Certbot not installed — cannot request SSL automatically."
        warn "Continuing with plain HTTP. Install certbot and run: certbot --nginx -d $PANEL_DOMAIN"
        return
    fi

    # Temporarily use the insecure config so certbot's webroot challenge can
    # answer on port 80.
    ln -sf /etc/nginx/sites-available/serverkit-insecure.conf /etc/nginx/sites-enabled/serverkit.conf
    step "Attempting Let's Encrypt certificate for $PANEL_DOMAIN..."
    if systemctl start nginx 2>/dev/null && \
       certbot certonly --webroot -w /var/www/certbot -d "$PANEL_DOMAIN" \
           --non-interactive --agree-tos --register-unsafely-without-email 2>/dev/null; then
        SSL_MODE="secure"
        good "Let's Encrypt certificate issued for $PANEL_DOMAIN."
    else
        SSL_MODE="insecure"
        warn "Could not obtain SSL certificate for $PANEL_DOMAIN."
        warn "Common causes: DNS not pointing to this server, port 80 not reachable, or rate limits."
        warn "Continuing with plain HTTP. Retry later with: certbot --nginx -d $PANEL_DOMAIN"
    fi
    systemctl stop nginx 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Install the nginx config matching the chosen SSL mode.
# ---------------------------------------------------------------------------
install_nginx_config_for_mode() {
    if [ "$SSL_MODE" = "secure" ]; then
        sed -i "s|/etc/letsencrypt/live/YOUR_DOMAIN/|/etc/letsencrypt/live/$PANEL_DOMAIN/|g" \
            /etc/nginx/sites-available/serverkit.conf
        ln -sf /etc/nginx/sites-available/serverkit.conf /etc/nginx/sites-enabled/serverkit.conf
    else
        ln -sf /etc/nginx/sites-available/serverkit-insecure.conf /etc/nginx/sites-enabled/serverkit.conf
    fi
    mkdir -p /etc/serverkit
    printf '%s\n' "$SSL_MODE" > /etc/serverkit/ssl-mode
    # Persist the domain so update.sh can re-apply the cert path on upgrades
    # without depending on the (commented-out) .env public URL.
    [ -n "$PANEL_DOMAIN" ] && printf '%s\n' "$PANEL_DOMAIN" > /etc/serverkit/panel-domain
}

# ---------------------------------------------------------------------------
# Server-wide TLS floor. Rewrites the ssl_protocols / ssl_ciphers lines in the
# main nginx.conf (or injects them) so every HTTPS listener is forced onto
# TLS 1.2/1.3 with AEAD-only ciphers. Editing nginx.conf in place -- rather than
# adding a conf.d snippet -- avoids nginx's "duplicate ssl_protocols" error on
# distros (Debian/Ubuntu) that already set it in http{}. Idempotent.
# ---------------------------------------------------------------------------
harden_global_tls() {
    local conf=/etc/nginx/nginx.conf
    [ -f "$conf" ] || return 0
    local ciphers='ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384'

    if grep -qE '^[[:space:]]*ssl_protocols[[:space:]]' "$conf"; then
        sed -i -E 's|^([[:space:]]*)ssl_protocols[[:space:]].*|\1ssl_protocols TLSv1.2 TLSv1.3;|' "$conf"
    else
        sed -i '/http {/a \    ssl_protocols TLSv1.2 TLSv1.3;' "$conf"
    fi

    if grep -qE '^[[:space:]]*ssl_ciphers[[:space:]]' "$conf"; then
        sed -i -E "s|^([[:space:]]*)ssl_ciphers[[:space:]].*|\1ssl_ciphers ${ciphers};|" "$conf"
    else
        sed -i "/http {/a \\    ssl_ciphers ${ciphers};" "$conf"
    fi
}

# ---------------------------------------------------------------------------
# systemd unit + CLI symlink
# ---------------------------------------------------------------------------
install_service() {
    phase "Systemd Service"

    cp "$INSTALL_DIR/serverkit-backend.service" /etc/systemd/system/serverkit.service
    chmod 644 /etc/systemd/system/serverkit.service

    chmod +x "$INSTALL_DIR/serverkit"
    ln -sf "$INSTALL_DIR/serverkit" /usr/local/bin/serverkit

    systemctl daemon-reload
    systemctl enable serverkit
    good "Systemd service installed."
}

# ---------------------------------------------------------------------------
# App templates
# ---------------------------------------------------------------------------
sync_templates() {
    phase "App Templates"

    if [ -d "$INSTALL_DIR/backend/templates" ]; then
        cp -r "$INSTALL_DIR/backend/templates/"*.yaml /etc/serverkit/templates/ 2>/dev/null || true
        cp -r "$INSTALL_DIR/backend/templates/"*.yml  /etc/serverkit/templates/ 2>/dev/null || true
        good "Installed $(ls /etc/serverkit/templates/*.yaml 2>/dev/null | wc -l) app templates."
    else
        warn "No app templates found."
    fi
}

# ---------------------------------------------------------------------------
# Bring services up
# ---------------------------------------------------------------------------
launch_services() {
    phase "Starting Services"

    step "Pruning stale Docker networks..."
    docker network prune -f 2>/dev/null || true
    docker container prune -f 2>/dev/null || true

    step "Building the frontend container..."
    cd "$INSTALL_DIR"
    docker compose build 2>&1 | tail -5

    step "Starting the backend..."
    systemctl start serverkit

    step "Starting the frontend container..."
    docker compose up -d 2>&1 | tail -5

    step "Starting nginx..."
    systemctl start nginx
    good "Services started."
}

# ---------------------------------------------------------------------------
# Health probe + automatic rollback
# ---------------------------------------------------------------------------
revert_install() {
    warn "Health check failed — rolling back..."

    systemctl stop serverkit 2>/dev/null || true
    systemctl stop nginx 2>/dev/null || true

    if [ -d "$INSTALL_DIR.backup" ]; then
        rm -rf "$INSTALL_DIR"
        mv "$INSTALL_DIR.backup" "$INSTALL_DIR"
        warn "Restored the previous installation from backup."
    fi

    systemctl daemon-reload
    systemctl start serverkit 2>/dev/null || true
    systemctl start nginx 2>/dev/null || true
    halt "Install rolled back. Inspect logs: journalctl -u serverkit -n 50"
}

await_health() {
    phase "Health Check"

    step "Waiting for the backend to answer..."
    local waited=0
    while [ "$waited" -lt 30 ]; do
        if curl -sf --max-time 5 http://127.0.0.1:5000/api/v1/system/health >/dev/null 2>&1; then
            good "Backend healthy."
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
    done

    warn "Backend did not respond on port 5000."
    return 1
}

# ---------------------------------------------------------------------------
# Safety copy of an existing install before we touch it
# ---------------------------------------------------------------------------
snapshot_existing() {
    if [ -d "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR.backup" ]; then
        step "Backing up the existing installation..."
        cp -a "$INSTALL_DIR" "$INSTALL_DIR.backup"
        good "Backup saved to $INSTALL_DIR.backup"
    fi
}

# ---------------------------------------------------------------------------
# Closing summary
# ---------------------------------------------------------------------------
print_outro() {
    local ip
    ip=$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || \
         hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP")

    printf '\n'
    printf '  %s%s✔  ServerKit installed successfully%s   %s%s%s\n' \
        "$BLD" "$HUE_OK" "$RST" "$FOG" "$(clock)" "$RST"
    printf '  %s%s%s\n\n' "$V4" "──────────────────────────────────────" "$RST"

    if [ -n "$PANEL_DOMAIN" ]; then
        if [ "$SSL_MODE" = "secure" ]; then
            printf '  %sPanel URL%s      https://%s\n' "$BLD" "$RST" "$PANEL_DOMAIN"
        else
            printf '  %sPanel URL%s      http://%s\n' "$BLD" "$RST" "$PANEL_DOMAIN"
        fi
    else
        printf '  %sPanel URL%s      http://%s\n' "$BLD" "$RST" "$ip"
    fi

    if [ "$SSL_MODE" != "secure" ]; then
        printf '\n  %sWARNING%s        Running without HTTPS. Passwords and tokens will be\n' "$BLD" "$RST"
        printf '                 transmitted unencrypted. Set PANEL_DOMAIN and run\n'
        printf '                 certbot, or set SERVERKIT_SKIP_SSL=1 to suppress this warning.\n'
    fi

    printf '\n  %sFirst step%s     create an admin user\n\n' "$BLD" "$RST"

    printf '  %sCLI%s            serverkit status\n' "$BLD" "$RST"
    printf '                 serverkit create-admin\n'
    printf '                 serverkit --help\n\n'

    printf '  %sService%s        systemctl status serverkit\n' "$BLD" "$RST"
    printf '                 journalctl -u serverkit -f\n'
    printf '                 systemctl restart serverkit\n\n'

    printf '  %sPaths%s          install : %s\n' "$BLD" "$RST" "$INSTALL_DIR"
    printf '                 config  : %s/.env\n' "$INSTALL_DIR"
    printf '                 backups : %s\n\n' "$BACKUP_DIR"

    printf '  %sUpdate%s         sudo serverkit update\n\n' "$HUE_WARN" "$RST"
}

# ---------------------------------------------------------------------------
# Anonymous install ping (best-effort)
# ---------------------------------------------------------------------------
ping_telemetry() {
    local v
    v=$(cat "$INSTALL_DIR/VERSION" 2>/dev/null | tr -d '\n\r ')
    curl -s "https://serverkit.ai/track/install?v=${v}" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Ask for a panel domain when running interactively
# ---------------------------------------------------------------------------
prompt_for_domain() {
    [ -z "$PANEL_DOMAIN" ] && [ -t 0 ] || return 0
    printf '\n'
    printf '%sEnter your panel domain (e.g. panel.example.com)%s\n' "$BLD" "$RST"
    printf 'Leave blank to access via IP (no SSL attempt)\n'
    printf '%sTip:%s set PANEL_DOMAIN=... in the environment to skip this prompt\n' "$BLD" "$RST"
    printf '      set SERVERKIT_SKIP_SSL=1 to disable HTTPS entirely\n'
    printf '> '
    read -r PANEL_DOMAIN
    PANEL_DOMAIN=$(printf '%s' "$PANEL_DOMAIN" | tr -d ' ')
    [ -n "$PANEL_DOMAIN" ] && PANEL_PORT="80"
}

# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
main() {
    STARTED_AT=$(date +%s)
    masthead

    # Default to a release install unless a source tree is already present or
    # the caller forced a source build / pinned a version.
    if [ "$BUILD_FROM_SOURCE" != "1" ] && [ ! -d "$INSTALL_DIR/backend/src" ] && [ -z "${SERVERKIT_VERSION:-}" ]; then
        INSTALL_FROM_RELEASE=1
    fi

    identify_system
    choose_pkg_manager
    preflight
    gauge_memory
    ensure_swap
    prompt_for_domain
    snapshot_existing

    provision_docker
    ensure_compose_plugin
    provision_node

    if [ "$INSTALL_FROM_RELEASE" = "1" ]; then
        fetch_release || warn "Falling back to a source build."
    fi

    if [ "$INSTALL_FROM_RELEASE" != "1" ]; then
        provision_python
        sync_source
        make_directories
        build_virtualenv
        build_frontend
    else
        make_directories
        # The CLI needs a venv even on release installs.
        if [ ! -d "$VENV_DIR" ]; then
            provision_python
            build_virtualenv
        fi
    fi

    sync_templates
    configure_nginx
    write_config
    install_service

    # Tolerate failures through start + health so rollback can run.
    set +e
    launch_services
    await_health || revert_install
    set -e

    ping_telemetry
    print_outro
}

main "$@"
