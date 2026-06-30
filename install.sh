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
SERVERKIT_DIR="${SERVERKIT_DIR:-/opt/serverkit}"
INSTALL_DIR="$SERVERKIT_DIR"
BASE_NAME="$(basename "$INSTALL_DIR")"
BASE_DIR="$(dirname "$INSTALL_DIR")"
DIR_A="$BASE_DIR/${BASE_NAME}-a"
DIR_B="$BASE_DIR/${BASE_NAME}-b"
VENV_DIR="${SERVERKIT_VENV_DIR:-$INSTALL_DIR/venv}"
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
SERVERKIT_OFFLINE_TARBALL="${SERVERKIT_OFFLINE_TARBALL:-}"
SERVERKIT_MIRROR_URL="${SERVERKIT_MIRROR_URL:-}"

# Runtime state populated as we go (declared up-front for `set -u`).
OS_FAMILY="unknown"
ARCH=""
DL_ARCH=""
PKG_MGR=""
SAFE_MODE=false
SSL_MODE="insecure"
FIRST_SLOT="$DIR_A"

# Resolve where this script (and thus the bundled scripts/lib helpers) lives so
# shared libraries load whether we run from a clone, a release tree, or piped
# through `curl | bash`. The clone-relative path is tried first; once the source
# is on disk under $INSTALL_DIR that path works too.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
load_serverkit_lib() {
    local name="$1" d
    for d in "$SELF_DIR/scripts/lib" "$INSTALL_DIR/scripts/lib"; do
        if [ -n "$d" ] && [ -f "$d/$name" ]; then
            # shellcheck source=/dev/null
            source "$d/$name"
            return 0
        fi
    done
    return 1
}

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
# Pure mapping from /etc/os-release ID (+ ID_LIKE fallback) to a ServerKit
# family. Kept as a standalone function so it is unit-testable without a real
# /etc/os-release. Echoes: debian|fedora|rhel|suse|arch|alpine|unknown.
os_family_from() {
    local id="$1" id_like="$2"
    case "$id" in
        ubuntu|linuxmint|pop|raspbian|elementary|zorin|debian|devuan)
            printf 'debian\n'; return ;;
        fedora|nobara)
            printf 'fedora\n'; return ;;
        rocky|almalinux|rhel|centos|ol|oracle|eurolinux)
            printf 'rhel\n'; return ;;
        opensuse*|sles|sled|suse|sle-micro)
            printf 'suse\n'; return ;;
        arch|manjaro|endeavouros|cachyos)
            printf 'arch\n'; return ;;
        alpine)
            printf 'alpine\n'; return ;;
    esac
    # Unknown ID — map via ID_LIKE to the closest supported family. Check rhel
    # before fedora: RHEL clones advertise ID_LIKE="rhel centos fedora" and want
    # the RHEL Docker repo, whereas a pure Fedora spin only lists "fedora".
    case " $id_like " in
        *debian*|*ubuntu*) printf 'debian\n' ;;
        *rhel*|*centos*)   printf 'rhel\n' ;;
        *fedora*)          printf 'fedora\n' ;;
        *suse*)            printf 'suse\n' ;;
        *arch*)            printf 'arch\n' ;;
        *alpine*)          printf 'alpine\n' ;;
        *)                 printf 'unknown\n' ;;
    esac
}

identify_system() {
    phase "Detecting System"

    local os_release="${SERVERKIT_OS_RELEASE:-/etc/os-release}"
    [ -f "$os_release" ] || halt "Cannot detect OS — $os_release is missing."
    . "$os_release"

    OS_FAMILY="$(os_family_from "${ID:-}" "${ID_LIKE:-}")"
    case "$OS_FAMILY" in
        unknown)
            warn "Untested OS '${ID:-unknown}' (ID_LIKE='${ID_LIKE:-}') — continuing anyway." ;;
        *)
            if [ "${ID:-}" = "$OS_FAMILY" ] || \
               { [ "$OS_FAMILY" = "debian" ] && [ "${ID:-}" = "ubuntu" ]; }; then
                good "Detected: ${PRETTY_NAME:-$ID} ($OS_FAMILY family)"
            else
                warn "Detected: ${PRETTY_NAME:-${ID:-unknown}} — treating as '$OS_FAMILY' family."
            fi
            ;;
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
# Detection order mirrors scripts/lib/pkg.sh. These run during the early
# dependency phase — before the repo (and thus scripts/lib) is on disk in the
# `curl | bash` path — so the logic is inline here and kept in sync with the lib.
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
    elif command -v zypper &>/dev/null; then
        PKG_MGR="zypper"
    elif command -v pacman &>/dev/null; then
        PKG_MGR="pacman"
    elif command -v apk &>/dev/null; then
        PKG_MGR="apk"
    else
        halt "No supported package manager found (need apt, dnf, yum, zypper, pacman, or apk)."
    fi
}

refresh_pkg_index() {
    case "$PKG_MGR" in
        apt)    apt-get update -y >/dev/null 2>&1 ;;
        dnf)    dnf makecache --refresh >/dev/null 2>&1 ;;
        yum)    yum makecache --refresh >/dev/null 2>&1 ;;
        zypper) zypper --non-interactive refresh >/dev/null 2>&1 ;;
        pacman) pacman -Sy --noconfirm >/dev/null 2>&1 ;;
        apk)    apk update >/dev/null 2>&1 ;;
    esac
}

pkg_add() {
    local out rc
    case "$PKG_MGR" in
        apt)    out=$(apt-get install -y "$@" 2>&1) ;;
        dnf)    out=$(dnf install -y "$@" 2>&1) ;;
        yum)    out=$(yum install -y "$@" 2>&1) ;;
        zypper) out=$(zypper --non-interactive install "$@" 2>&1) ;;
        pacman) out=$(pacman -S --noconfirm "$@" 2>&1) ;;
        apk)    out=$(apk add "$@" 2>&1) ;;
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
    # Prefer an explicit minor version, newest first, then bare python3. This
    # mirrors scripts/update.sh so a box that has python3.11 (Debian 12) but a
    # too-new/too-old default python3 is still recognized. Sets PYTHON_BIN and
    # returns 0 on success; returns 1 (without aborting) when nothing fits.
    local c v
    for c in python3.12 python3.11 python3; do
        if command -v "$c" &>/dev/null; then
            v=$("$c" -c 'import sys;print(".".join(map(str,sys.version_info[:2])))' 2>/dev/null || true)
            if [ -n "$v" ] && ver_in_range "$v"; then
                PYTHON_BIN="$c"
                good "Using $c (Python $v)"
                return 0
            fi
        fi
    done
    PYTHON_BIN=""
    return 1
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

    # Already have a supported interpreter? Nothing to do.
    if locate_python; then
        return
    fi

    warn "No supported Python ($PYTHON_MIN–$PYTHON_MAX) found — installing one."

    # Prefer the distro's own package over a source compile. Debian 12 ships
    # python3.11; Ubuntu 24.04 ships python3.12 (older Ubuntu falls back to the
    # deadsnakes PPA); Fedora/RHEL provide 3.12 or 3.11 in their repos. A slow,
    # fragile source build is now strictly the last resort.
    if [ "$OS_FAMILY" = "debian" ]; then
        if [ "${ID:-}" = "ubuntu" ]; then
            if ! pkg_add python3.12 python3.12-venv python3.12-dev; then
                step "Adding deadsnakes PPA for Python 3.12..."
                pkg_add software-properties-common
                add-apt-repository -y ppa:deadsnakes/ppa
                refresh_pkg_index
                pkg_add python3.12 python3.12-venv python3.12-dev
            fi
        else
            # Debian (and Debian-like): python3.11 lives in the main repo.
            refresh_pkg_index
            pkg_add python3.11 python3.11-venv python3.11-dev || \
                pkg_add python3.12 python3.12-venv python3.12-dev || true
        fi
    elif [ "$OS_FAMILY" = "fedora" ] || [ "$OS_FAMILY" = "rhel" ]; then
        pkg_add python3.12 python3.12-devel || pkg_add python3.11 python3.11-devel || true
    elif [ "$OS_FAMILY" = "suse" ]; then
        pkg_add python311 python311-devel || pkg_add python312 python312-devel || true
    elif [ "$OS_FAMILY" = "arch" ]; then
        # Rolling release — `python` is already 3.11+.
        pkg_add python || true
    elif [ "$OS_FAMILY" = "alpine" ]; then
        pkg_add python3 python3-dev || true
    fi

    # Did a distro package give us something usable?
    if locate_python; then
        good "Python ready: $PYTHON_BIN"
        return
    fi

    # Last resort: compile from source.
    warn "Distro packages did not provide a supported Python — building from source."
    if [ "$OS_FAMILY" = "debian" ]; then
        pkg_add wget zlib1g-dev libbz2-dev libreadline-dev \
            libsqlite3-dev libncurses5-dev libncursesw5-dev \
            xz-utils tk-dev liblzma-dev libffi-dev libssl-dev
    else
        pkg_add wget zlib-devel bzip2-devel readline-devel \
            sqlite-devel ncurses-devel xz-devel tk-devel libffi-devel
    fi
    build_python_from_source
    PYTHON_BIN="python3.12"

    command -v "$PYTHON_BIN" &>/dev/null || \
        halt "Could not install a supported Python — install Python 3.11 or 3.12 by hand."
    good "Python installed ($PYTHON_BIN)."
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
        suse)
            pkg_add docker docker-compose
            ;;
        arch)
            pkg_add docker docker-compose
            ;;
        alpine)
            pkg_add docker docker-cli-compose
            ;;
        *)
            curl -fsSL https://get.docker.com | sh
            ;;
    esac

    # Enable + start across init systems (systemd on most families, OpenRC on
    # Alpine). Guarded so a non-systemd box doesn't abort the install here.
    if command -v systemctl &>/dev/null && [ -d /run/systemd/system ]; then
        systemctl enable docker 2>/dev/null || true
        systemctl start docker 2>/dev/null || true
    elif command -v rc-update &>/dev/null; then
        rc-update add docker default 2>/dev/null || true
        rc-service docker start 2>/dev/null || true
    fi
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
# Node 18+ is the floor for the Vite frontend build. Distro nodejs on every
# currently-supported target (Ubuntu 24.04, Debian 12, Fedora 40+) already meets
# it, so we install the distro package first and only pipe NodeSource into bash
# when the distro can't deliver a new-enough Node + npm.
node_major()  { node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
node_ready()  {
    command -v node &>/dev/null && command -v npm &>/dev/null || return 1
    local m; m="$(node_major)"
    [ -n "$m" ] && [ "$m" -ge 18 ] 2>/dev/null
}

provision_node() {
    phase "Node.js"

    if [ "$INSTALL_FROM_RELEASE" = "1" ]; then
        good "Skipping Node.js — the release ships a pre-built frontend."
        return
    fi

    if node_ready; then
        good "Node.js already present: $(node --version)"
        return
    fi

    step "Installing Node.js (distro repo first)..."
    # Debian/Ubuntu split npm into its own package; Fedora bundles it.
    pkg_add nodejs npm 2>/dev/null || pkg_add nodejs 2>/dev/null || true
    command -v npm &>/dev/null || pkg_add npm 2>/dev/null || true

    if ! node_ready; then
        warn "Distro Node.js is missing or older than 18 — falling back to NodeSource 20."
        if [ "$OS_FAMILY" = "debian" ]; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
        else
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
        fi
        pkg_add nodejs || true
    fi

    node_ready || \
        halt "Node.js 18+ (with npm) is required but could not be installed. Install Node 20 LTS and re-run."
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

    local tag tarball tmp_dir unpacked

    if [ -n "$SERVERKIT_OFFLINE_TARBALL" ]; then
        [ -f "$SERVERKIT_OFFLINE_TARBALL" ] || halt "Offline tarball not found: $SERVERKIT_OFFLINE_TARBALL"
        tag="offline"
        tarball="$SERVERKIT_OFFLINE_TARBALL"
        good "Using offline tarball: $tarball"
    else
        tag=$(resolve_release_tag)
        if [ -z "$tag" ]; then
            warn "Latest release tag unknown — falling back to a source build."
            INSTALL_FROM_RELEASE=0
            return 1
        fi
        good "Latest release: $tag"

        local base
        if [ -n "$SERVERKIT_MIRROR_URL" ]; then
            base="$SERVERKIT_MIRROR_URL"
        else
            base="https://github.com/${GITHUB_REPO}/releases/download/${tag}"
        fi

        tarball="/tmp/serverkit-${tag}-linux-${DL_ARCH}.tar.gz"
        step "Fetching release tarball (${DL_ARCH})..."
        if ! curl -sfL "${base}/serverkit-${tag}-linux-${DL_ARCH}.tar.gz" -o "$tarball"; then
            warn "No release tarball for this platform — falling back to source."
            INSTALL_FROM_RELEASE=0
            return 1
        fi

        step "Verifying checksum..."
        if curl -sfL "${base}/checksums.txt" -o "/tmp/serverkit-checksums-${tag}.txt"; then
            if ! (cd /tmp && sha256sum -c <(grep "serverkit-${tag}-linux-${DL_ARCH}.tar.gz" "serverkit-checksums-${tag}.txt") >/dev/null 2>&1); then
                halt "Checksum verification failed for release tarball."
            fi
            good "Checksum verified"
        else
            warn "Could not download checksums.txt — skipping verification"
        fi
    fi

    step "Unpacking release..."
    tmp_dir="$(mktemp -d)"
    tar xzf "$tarball" -C "$tmp_dir"

    unpacked="$tmp_dir/serverkit"
    [ ! -d "$unpacked" ] && unpacked="$tmp_dir/opt/serverkit"
    if [ ! -d "$unpacked" ]; then
        unpacked="$(find "$tmp_dir" -maxdepth 2 -type d -name serverkit | head -n1)"
    fi
    [ -d "$unpacked" ] || halt "Release tarball layout is unrecognized (expected serverkit/ or opt/serverkit/)."

    ensure_install_layout
    rm -rf "$FIRST_SLOT"
    cp -a "$unpacked" "$FIRST_SLOT"
    rm -rf "$tmp_dir"

    [ -L "$INSTALL_DIR" ] || ln -s "$FIRST_SLOT" "$INSTALL_DIR"

    chmod +x "$INSTALL_DIR/serverkit"
    chmod +x "$INSTALL_DIR/scripts/"*.sh 2>/dev/null || true
    good "Release unpacked into $FIRST_SLOT"
}

# ---------------------------------------------------------------------------
# Source path: fetch / refresh the repository
# ---------------------------------------------------------------------------
sync_source() {
    phase "Source Code"

    ensure_install_layout

    if [ -d "$FIRST_SLOT/.git" ]; then
        step "Refreshing the existing checkout..."
        cd "$FIRST_SLOT"
        if ! git pull --ff-only; then
            warn "Fast-forward failed (local edits?) — hard-resetting to origin/main."
            git fetch origin
            git reset --hard origin/main
        fi
    else
        step "Cloning ServerKit..."
        rm -rf "$FIRST_SLOT"
        git clone --depth 1 "https://github.com/${GITHUB_REPO}.git" "$FIRST_SLOT"
        cd "$FIRST_SLOT"
    fi
    [ -L "$INSTALL_DIR" ] || ln -sfn "$FIRST_SLOT" "$INSTALL_DIR"
    good "Repository ready."
}

# ---------------------------------------------------------------------------
# On-disk layout (blue/green slots + symlink)
# ---------------------------------------------------------------------------
ensure_install_layout() {
    # Migrate legacy real-directory installs into the blue/green layout.
    if [ -d "$INSTALL_DIR" ] && [ ! -L "$INSTALL_DIR" ]; then
        step "Migrating to blue/green install layout..."
        mv "$INSTALL_DIR" "$FIRST_SLOT"
        ln -s "$FIRST_SLOT" "$INSTALL_DIR"
        good "Active install is now $INSTALL_DIR → $FIRST_SLOT"
    fi

    mkdir -p "$DIR_A" "$DIR_B"
    [ -L "$INSTALL_DIR" ] || ln -s "$FIRST_SLOT" "$INSTALL_DIR"
}

make_directories() {
    phase "Creating Directories"

    ensure_install_layout

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

    # If the release shipped a pre-built venv at the expected path, use it.
    if [ "$INSTALL_FROM_RELEASE" = "1" ] && [ -f "$FIRST_SLOT/venv/bin/activate" ] && [ -x "$FIRST_SLOT/venv/bin/python" ]; then
        step "Using pre-built virtual environment from release..."
        rm -rf "$VENV_DIR"
        cp -a "$FIRST_SLOT/venv" "$VENV_DIR"
        good "Virtual environment installed from release."
        return
    fi

    step "Creating the virtual environment..."
    $PYTHON_BIN -m venv "$VENV_DIR"
    if [ ! -f "$VENV_DIR/bin/activate" ]; then
        halt "Virtual environment creation failed: $VENV_DIR/bin/activate not found."
    fi
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
    encryption_key=$("${PYTHON_BIN:-python3}" -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')

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
# Firewall: open 80/443 so the panel is reachable from the outside, and record
# exactly what we opened in /etc/serverkit/install-state.json so uninstall can
# undo only those rules. Fresh RHEL-family boxes run firewalld by default, which
# is the #1 reason an otherwise-good install looks "broken" (port 80 blocked).
# ---------------------------------------------------------------------------
configure_firewall() {
    phase "Firewall"

    if ! load_serverkit_lib firewall.sh; then
        warn "Firewall helper not found — open ports 80/443 manually if needed."
        return 0
    fi
    load_serverkit_lib state.sh || true

    local backend
    backend="$(firewall_detect)"
    if [ "$backend" = "none" ]; then
        warn "No active firewall detected — assuming ports 80/443 are already open."
        return 0
    fi

    step "Opening HTTP/HTTPS (80, 443) via $backend..."
    firewall_open "$backend" 80/tcp 443/tcp
    if [ "${FW_DRY_RUN:-0}" != "1" ] && command -v state_set >/dev/null 2>&1; then
        state_set firewall_backend "$backend"
        state_append firewall_ports 80/tcp
        state_append firewall_ports 443/tcp
    fi
    good "Firewall configured ($backend): 80/tcp and 443/tcp open."
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

    # The panel frontend is served as static files by host nginx (no container).
    # The shipped config roots at the default /opt/serverkit; point it at the real
    # install dir when SERVERKIT_DIR was customised.
    apply_frontend_root /etc/nginx/sites-available/serverkit.conf \
                        /etc/nginx/sites-available/serverkit-insecure.conf

    # Decide whether we can use HTTPS. SSL is best-effort: if certbot fails or
    # no domain is given, we fall back to plain HTTP rather than forcing the
    # user to fix DNS/certs before they can use ServerKit.
    choose_ssl_mode
    install_nginx_config_for_mode

    # SELinux: let nginx make upstream connections to the app containers AND read
    # the SPA bundle it now serves from $INSTALL_DIR (default /opt, which is not
    # httpd_sys_content_t by default — without this nginx 403s every panel asset).
    if { [ "$OS_FAMILY" = "fedora" ] || [ "$OS_FAMILY" = "rhel" ]; } && command -v setsebool &>/dev/null; then
        setsebool -P httpd_can_network_connect 1 2>/dev/null || true
    fi
    selinux_label_frontend_dist

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

# Point the static-frontend `root` at the real install dir. The shipped nginx
# config defaults to /opt/serverkit; only a customised SERVERKIT_DIR needs the
# rewrite. update.sh's refresh_config carries the same logic across upgrades.
apply_frontend_root() {
    [ "$INSTALL_DIR" = "/opt/serverkit" ] && return 0
    local f
    for f in "$@"; do
        [ -f "$f" ] && sed -i "s|/opt/serverkit/frontend/dist|$INSTALL_DIR/frontend/dist|g" "$f"
    done
}

# Label the SPA bundle so SELinux-enforcing hosts (Fedora/RHEL) let nginx read
# it. /opt is not httpd_sys_content_t by default, so without this every panel
# asset 403s. Label the *real* slot path (blue/green resolves through a symlink).
# Best-effort: a permissive/disabled box, or one without the tools, just no-ops.
selinux_label_frontend_dist() {
    command -v selinuxenabled &>/dev/null && selinuxenabled 2>/dev/null || return 0
    local real dist
    real="$(readlink -f "$INSTALL_DIR" 2>/dev/null || echo "$INSTALL_DIR")"
    dist="${real}/frontend/dist"
    [ -d "$dist" ] || return 0
    if command -v semanage &>/dev/null && command -v restorecon &>/dev/null; then
        semanage fcontext -a -t httpd_sys_content_t "${dist}(/.*)?" 2>/dev/null \
            || semanage fcontext -m -t httpd_sys_content_t "${dist}(/.*)?" 2>/dev/null || true
        restorecon -R "$dist" 2>/dev/null || true
    elif command -v chcon &>/dev/null; then
        chcon -R -t httpd_sys_content_t "$dist" 2>/dev/null || true
    fi
}

# ---------------------------------------------------------------------------
# Server-wide TLS floor — force every HTTPS listener onto TLS 1.2/1.3 with
# AEAD-only ciphers, so even the default server and non-ServerKit vhosts can't
# negotiate weak TLS.
#
# Preferred: drop a self-contained /etc/nginx/conf.d/serverkit-tls.conf snippet
# — ServerKit-owned, trivially reversible on uninstall, and never touches the
# distro's nginx.conf. BUT a snippet is `include`d into the same http{} context,
# so if nginx.conf ALREADY declares ssl_protocols (Debian/Ubuntu do) a second
# declaration is a "duplicate ssl_protocols" error. In that case we fall back to
# rewriting the existing directives in place. Idempotent either way.
# ---------------------------------------------------------------------------
harden_global_tls() {
    local nginx_dir="${SERVERKIT_NGINX_DIR:-/etc/nginx}"
    local conf="$nginx_dir/nginx.conf"
    [ -f "$conf" ] || return 0
    local ciphers='ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384'

    # Does the main config already declare these in http{}? (Debian/Ubuntu yes,
    # RHEL/Fedora/SUSE typically no.)
    local has_proto=0 has_ciphers=0
    grep -qE '^[[:space:]]*ssl_protocols[[:space:]]' "$conf" && has_proto=1
    grep -qE '^[[:space:]]*ssl_ciphers[[:space:]]'   "$conf" && has_ciphers=1

    # The conf.d snippet is only safe when neither directive already exists AND
    # nginx.conf includes conf.d/*.conf inside http{} (the default on every
    # supported family).
    if [ "$has_proto" = "0" ] && [ "$has_ciphers" = "0" ] && \
       grep -qE 'include[[:space:]]+/etc/nginx/conf\.d/\*\.conf' "$conf"; then
        mkdir -p "$nginx_dir/conf.d"
        cat > "$nginx_dir/conf.d/serverkit-tls.conf" <<EOF
# Auto-generated by ServerKit — server-wide TLS floor. Safe to remove.
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ${ciphers};
EOF
        return 0
    fi

    # Fall back to editing nginx.conf in place (a snippet would duplicate the
    # existing directive). Remove any stale snippet we may have dropped before.
    rm -f "$nginx_dir/conf.d/serverkit-tls.conf" 2>/dev/null || true
    if [ "$has_proto" = "1" ]; then
        sed -i -E 's|^([[:space:]]*)ssl_protocols[[:space:]].*|\1ssl_protocols TLSv1.2 TLSv1.3;|' "$conf"
    else
        sed -i '/http {/a \    ssl_protocols TLSv1.2 TLSv1.3;' "$conf"
    fi
    if [ "$has_ciphers" = "1" ]; then
        sed -i -E "s|^([[:space:]]*)ssl_ciphers[[:space:]].*|\1ssl_ciphers ${ciphers};|" "$conf"
    else
        sed -i "/http {/a \\    ssl_ciphers ${ciphers};" "$conf"
    fi
}

# ---------------------------------------------------------------------------
# systemd unit + CLI symlink
# ---------------------------------------------------------------------------
# Render the systemd unit from the template to <out>, substituting the resolved
# install/venv/log paths so a custom SERVERKIT_DIR is honored (the old hardcoded
# unit baked in /opt/serverkit). The unit references the /opt/serverkit symlink,
# so blue/green switches need no re-render. Returns 1 if no template/unit exists.
render_service_unit() {
    local out="$1"
    local template="$INSTALL_DIR/templates/serverkit-backend.service.in"
    if [ -f "$template" ]; then
        sed -e "s|@SERVERKIT_DIR@|$INSTALL_DIR|g" \
            -e "s|@SERVERKIT_VENV_DIR@|$VENV_DIR|g" \
            -e "s|@PORT@|5000|g" \
            -e "s|@USER@|root|g" \
            -e "s|@LOG_DIR@|$LOG_DIR|g" \
            "$template" > "$out"
        return 0
    elif [ -f "$INSTALL_DIR/serverkit-backend.service" ]; then
        cp "$INSTALL_DIR/serverkit-backend.service" "$out"
        return 0
    fi
    return 1
}

install_service() {
    phase "Systemd Service"

    render_service_unit /etc/systemd/system/serverkit.service || \
        halt "No systemd unit template found at $INSTALL_DIR/templates/serverkit-backend.service.in"
    chmod 644 /etc/systemd/system/serverkit.service

    chmod +x "$INSTALL_DIR/serverkit"
    ln -sf "$INSTALL_DIR/serverkit" /usr/local/bin/serverkit

    # Without systemd (LXC/WSL/containers) we can't enable the unit — say so
    # clearly instead of failing cryptically (Goal G5).
    load_serverkit_lib env.sh || true
    if command -v has_systemd >/dev/null 2>&1 && ! has_systemd; then
        warn "systemd not detected — installed the unit but cannot enable/start it here."
        warn "Start the backend with a supervisor, or run it in the foreground; see docs/ARCHITECTURE.md."
        return 0
    fi

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

    step "Starting the backend..."
    systemctl start serverkit

    # The frontend is static files served by host nginx (built into
    # frontend/dist by build_frontend) — no container to build or start.
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

    local active
    active="$(readlink -f "$INSTALL_DIR" 2>/dev/null || echo "$INSTALL_DIR")"
    if [ -d "$active.backup" ]; then
        rm -rf "$active"
        cp -a "$active.backup" "$active"
        warn "Restored the previous installation from $active.backup"
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
    local active
    active="$(readlink -f "$INSTALL_DIR" 2>/dev/null || echo "$INSTALL_DIR")"
    if [ -d "$active" ] && [ ! -d "$active.backup" ]; then
        step "Backing up the existing installation..."
        cp -a "$active" "$active.backup"
        good "Backup saved to $active.backup"
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
        # Release tarballs now ship a pre-built, relocatable venv. If one is
        # present, build_virtualenv will use it; otherwise it falls back to a
        # local build.
        provision_python
        build_virtualenv
    fi

    sync_templates
    configure_nginx
    configure_firewall
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

# Sourcing this file (e.g. from scripts/test/test_install.sh) defines every
# function above for unit testing without running an install. Only a direct
# execution falls through to the run below.
[ "${BASH_SOURCE[0]}" = "${0}" ] || return 0

main "$@"
