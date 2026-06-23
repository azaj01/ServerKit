#!/usr/bin/env bash
set -Eeuo pipefail

########################################
# ServerKit Uninstaller
########################################

INSTALL_DIR="/opt/serverkit"
DATA_DIR="/var/lib/serverkit"
LOG_DIR="/var/log/serverkit"
LOG_FILE="/var/log/serverkit-uninstall.log"

mkdir -p /var/log
exec > >(tee -a "$LOG_FILE") 2>&1

########################################
# Colors
########################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Truecolor ServerKit identity (degrades to plain text when not supported)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
    ESC=$'\033'
    RST_TC="${ESC}[0m"; BLD_TC="${ESC}[1m"
    paint() { printf '%s[38;2;%d;%d;%dm' "$ESC" "$1" "$2" "$3"; }
else
    RST_TC=''; BLD_TC=''
    paint() { :; }
fi

V1="$(paint 196 181 253)"; V2="$(paint 167 139 250)"; V3="$(paint 139 92 246)"
V4="$(paint 124 58 237)";  V5="$(paint 109 40 217)"
PAPER_TC="$(paint 237 233 254)"; ASH_TC="$(paint 165 160 190)"; FOG_TC="$(paint 113 108 140)"
HUE_OK_TC="$(paint 52 211 153)"; HUE_WARN_TC="$(paint 250 204 21)"; HUE_ERR_TC="$(paint 248 113 113)"; HUE_LINK_TC="$(paint 103 232 249)"

########################################
# UI helpers
########################################

print_header() {
    local ver="unknown"
    [ -f "${INSTALL_DIR}/VERSION" ] && ver=$(tr -d '\r\n ' < "${INSTALL_DIR}/VERSION")
    printf '\n'
    printf '  %s%s▖▌▌%s  %s%sServerKit%s  %sv%s%s  %s•%s %sUninstaller%s\n' \
        "${BLD_TC}" "${V2}" "${RST_TC}" "${BLD_TC}" "${PAPER_TC}" "${RST_TC}" "${FOG_TC}" "$ver" "${RST_TC}" \
        "${HUE_WARN_TC}" "${RST_TC}" "${ASH_TC}" "${RST_TC}"
    printf '  %s%s▌▖▌%s  %sSelf-hosted infrastructure, made simple.%s\n' \
        "${BLD_TC}" "${V3}" "${RST_TC}" "${ASH_TC}" "${RST_TC}"
    printf '  %s%s▌▌▖%s  %sWeb apps · Databases · Docker · Email · DNS · Security%s\n' \
        "${BLD_TC}" "${V4}" "${RST_TC}" "${FOG_TC}" "${RST_TC}"
    printf '  %s%s▘▘▘%s  %sPython + React, one command · serverkit.ai%s\n' \
        "${BLD_TC}" "${V5}" "${RST_TC}" "${FOG_TC}" "${RST_TC}"
    printf '\n'
}

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}! $1${NC}"; }
print_info() { echo -e "${BLUE}→ $1${NC}"; }

########################################
# Root check
########################################

if [[ $EUID -ne 0 ]]; then
    print_error "Please run as root (sudo)"
    exit 1
fi

print_header

########################################
# Confirm uninstall
########################################

echo
read -p "Remove ServerKit completely? (y/N): " confirm

if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    print_warning "Uninstall cancelled"
    exit 0
fi

########################################
# Stop services
########################################

print_info "Stopping ServerKit service"

systemctl stop serverkit 2>/dev/null || true
systemctl disable serverkit 2>/dev/null || true

print_success "Backend service stopped"

########################################
# Stop containers
########################################

print_info "Stopping Docker containers"

if command -v docker &>/dev/null && [ -d "$INSTALL_DIR" ]; then
    docker compose --project-directory "$INSTALL_DIR" down --remove-orphans 2>/dev/null || true
else
    print_warning "Docker or install directory not found, skipping container cleanup"
fi

print_success "Containers removed"

########################################
# Remove systemd service
########################################

print_info "Removing systemd service"

rm -f /etc/systemd/system/serverkit.service

systemctl daemon-reload

print_success "Systemd service removed"

########################################
# Remove nginx config
########################################

print_info "Removing nginx configuration"

rm -f /etc/nginx/sites-enabled/serverkit.conf 2>/dev/null || true
rm -f /etc/nginx/sites-available/serverkit.conf 2>/dev/null || true

systemctl reload nginx 2>/dev/null || true

print_success "Nginx config removed"

########################################
# Remove files
########################################

print_info "Removing installation files"

rm -rf "$INSTALL_DIR"

print_success "Installation directory removed"

########################################
# Remove data
########################################

print_info "Removing data directory"

rm -rf "$DATA_DIR"
rm -rf /etc/serverkit
rm -rf /var/serverkit

print_success "Data directories removed"

########################################
# Remove logs
########################################

print_info "Removing logs"

rm -rf "$LOG_DIR"

print_success "Log directory removed"

########################################
# Remove CLI
########################################

print_info "Removing CLI command"

rm -f /usr/local/bin/serverkit

print_success "CLI removed"

########################################
# Track uninstall
########################################

curl -s "https://serverkit.ai/track/uninstall" >/dev/null 2>&1 || true

########################################
# Finish
########################################

echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ServerKit removed successfully${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo
echo "Uninstall log:"
echo "$LOG_FILE"
echo
