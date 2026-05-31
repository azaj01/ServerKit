#!/bin/bash
#
# ServerKit Quick Install Script for Ubuntu/Debian/Fedora
#
# Architecture:
#   - Backend: Runs directly on host (for full system access)
#   - Frontend: Runs in Docker (nginx serving static files)
#
# Usage: curl -fsSL https://serverkit.ai/install.sh | bash
#

set -e

# Safety: Move to a valid directory first
# Prevents "getcwd: cannot access parent directories" error
# when running from a deleted directory (e.g., after uninstall)
cd /tmp 2>/dev/null || cd / || true

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="/opt/serverkit"
VENV_DIR="$INSTALL_DIR/venv"
LOG_DIR="/var/log/serverkit"
DATA_DIR="/var/lib/serverkit"

# Python constraints
PYTHON_MIN="3.11"
PYTHON_MAX="3.12"
PYTHON_BIN=""

SAFE_MODE=false

print_header() {
    echo -e "${BLUE}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ServerKit Installer"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${NC}"
}

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}! $1${NC}"; }
print_info() { echo -e "${BLUE}→ $1${NC}"; }

version_ge() { printf '%s\n%s' "$2" "$1" | sort -C -V; }
version_le() { printf '%s\n%s' "$1" "$2" | sort -C -V; }

# Detect supported Python (3.11-3.12)
detect_python() {
    if command -v python3 &>/dev/null; then
        PY_VER=$(python3 -c 'import sys;print(".".join(map(str,sys.version_info[:2])))')
        if version_ge "$PY_VER" "$PYTHON_MIN" && version_le "$PY_VER" "$PYTHON_MAX"; then
            PYTHON_BIN="python3"
            print_success "Using system Python $PY_VER"
            return
        fi
    fi
    print_warning "System Python not in supported range ($PYTHON_MIN-$PYTHON_MAX)"
}

# Check RAM and enable safe mode for small VPS
check_ram() {
    RAM=$(free -m | awk '/Mem:/ {print $2}')
    if [ "$RAM" -le 700 ]; then
        SAFE_MODE=true
        print_warning "Low RAM detected (${RAM}MB) → enabling VPS Safe Mode"
    fi
}

# Create swap if system has very little
setup_swap() {
    SWAP_TOTAL=$(free -m | awk '/^Swap:/ {print $2}')
    if [ "$SWAP_TOTAL" -lt 512 ]; then
        print_info "Creating swap space (1GB)..."
        if [ ! -f /swapfile ]; then
            fallocate -l 1G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
            chmod 600 /swapfile
            mkswap /swapfile >/dev/null
        fi
        swapon /swapfile 2>/dev/null || true
        print_success "Swap enabled"
    fi
}

print_header

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    print_error "Please run as root (sudo)"
    exit 1
fi

# Enable low-RAM protections early (needs root for swap)
check_ram
setup_swap

# Detect OS family
OS_FAMILY="unknown"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    if [ "$ID" = "ubuntu" ] || [ "$ID" = "debian" ]; then
        OS_FAMILY="debian"
    elif [ "$ID" = "fedora" ]; then
        OS_FAMILY="fedora"
    elif [ "$ID" = "rocky" ] || [ "$ID" = "almalinux" ] || [ "$ID" = "rhel" ] || [ "$ID" = "centos" ]; then
        # Rocky / Alma / RHEL / CentOS share dnf + the docker-ce rhel repo.
        OS_FAMILY="rhel"
    else
        print_warning "Unsupported OS ($ID). This script is designed for Ubuntu/Debian/Fedora/Rocky."
    fi
else
    print_warning "Cannot detect OS. Proceeding with caution."
fi

echo ""
print_info "Installing system dependencies..."

if [ "$OS_FAMILY" = "debian" ] || [ "$OS_FAMILY" = "unknown" ]; then
    # Configure needrestart for non-interactive mode (Ubuntu 22.04+)
    # This prevents the "Which services should be restarted?" dialog
    # and avoids dpkg lock issues during automated installs
    export NEEDRESTART_MODE=a
    export DEBIAN_FRONTEND=noninteractive

    # Also configure needrestart.conf if it exists for future apt operations
    if [ -f /etc/needrestart/needrestart.conf ]; then
        sed -i "s/#\$nrconf{restart} = 'i';/\$nrconf{restart} = 'a';/" /etc/needrestart/needrestart.conf 2>/dev/null || true
    fi

    apt-get update


    apt-get install -y \
        python3 \
        python3-pip \
        python3-venv \
        python3-dev \
        git \
        curl \
        build-essential \
        libffi-dev \
        libssl-dev \
        iproute2 \
        procps

    detect_python

    # If system Python is out of supported range, install 3.12
    if [ -z "$PYTHON_BIN" ]; then
        print_info "Installing Python 3.12..."

        if [ "$ID" = "ubuntu" ]; then
            # Ubuntu: use deadsnakes PPA
            apt-get install -y software-properties-common
            add-apt-repository -y ppa:deadsnakes/ppa
            apt-get update
            apt-get install -y python3.12 python3.12-venv python3.12-dev
            PYTHON_BIN="python3.12"
        else
            # Debian / other apt-based: build from source
            print_info "Building Python 3.12 from source (this may take a few minutes)..."
            apt-get install -y wget zlib1g-dev libbz2-dev libreadline-dev \
                libsqlite3-dev libncurses5-dev libncursesw5-dev \
                xz-utils tk-dev liblzma-dev
            cd /tmp
            wget -q https://www.python.org/ftp/python/3.12.8/Python-3.12.8.tgz
            tar xzf Python-3.12.8.tgz
            cd Python-3.12.8
            ./configure --enable-optimizations --prefix=/usr/local 2>&1 | tail -1
            make -j"$(nproc)" 2>&1 | tail -1
            make altinstall 2>&1 | tail -1
            cd /tmp && rm -rf Python-3.12.8 Python-3.12.8.tgz
            PYTHON_BIN="python3.12"
        fi

        if ! command -v "$PYTHON_BIN" &>/dev/null; then
            print_error "Failed to install Python 3.12. Please install Python 3.11 or 3.12 manually."
            exit 1
        fi
        print_success "Python 3.12 installed"
    fi

elif [ "$OS_FAMILY" = "fedora" ] || [ "$OS_FAMILY" = "rhel" ]; then
    # Rocky/Alma/RHEL need EPEL for some packages (python3.12 on RHEL 9, etc.)
    if [ "$OS_FAMILY" = "rhel" ] && ! rpm -q epel-release >/dev/null 2>&1; then
        dnf install -y epel-release || true
    fi

    dnf makecache --refresh

    # On Rocky/RHEL 9.7+, the updates stream ships openssl-libs 3.5.x
    # which has a different ABI than the older openssl-3.0.x most boxes
    # ship with. If subsequent dnf installs pull in the new openssl-libs
    # as a transitive dep (e.g. via libcurl from `dnf install curl`),
    # every new sshd fork dies with "OpenSSL version mismatch" — TCP
    # accepts, then RST, and remote installs over SSH fail silently.
    # Pull openssh + openssl in the same transaction up front so the
    # post-transaction scriptlet restarts sshd against a matched
    # openssh-server/openssl-libs pair. sshd.service uses
    # KillMode=process so existing SSH sessions survive the restart.
    if [ "$OS_FAMILY" = "rhel" ]; then
        dnf upgrade -y openssh openssh-server openssh-clients \
            openssl openssl-libs openssl-devel 2>/dev/null || true
    fi

    dnf install -y \
        python3 \
        python3-pip \
        python3-devel \
        git \
        curl \
        gcc \
        gcc-c++ \
        make \
        libffi-devel \
        openssl-devel \
        python3-devel \
        iproute \
        procps-ng

    detect_python

    if [ -z "$PYTHON_BIN" ]; then
        print_info "Installing Python 3.12..."
        if dnf install -y python3.12 python3.12-devel 2>/dev/null; then
            PYTHON_BIN="python3.12"
        else
            # Fallback: build from source
            print_info "Building Python 3.12 from source (this may take a few minutes)..."
            dnf install -y wget zlib-devel bzip2-devel readline-devel \
                sqlite-devel ncurses-devel xz-devel tk-devel libffi-devel
            cd /tmp
            wget -q https://www.python.org/ftp/python/3.12.8/Python-3.12.8.tgz
            tar xzf Python-3.12.8.tgz
            cd Python-3.12.8
            ./configure --enable-optimizations --prefix=/usr/local 2>&1 | tail -1
            make -j"$(nproc)" 2>&1 | tail -1
            make altinstall 2>&1 | tail -1
            cd /tmp && rm -rf Python-3.12.8 Python-3.12.8.tgz
            PYTHON_BIN="python3.12"
        fi

        if ! command -v "$PYTHON_BIN" &>/dev/null; then
            print_error "Failed to install Python 3.12. Please install Python 3.11 or 3.12 manually."
            exit 1
        fi
        print_success "Python 3.12 installed"
    fi
fi

print_success "System dependencies installed"

# Install Docker if not present.
#
# Why not just `curl get.docker.com | sh` on Fedora/RHEL?
# Docker recently added `docker-model-plugin` to that script's package
# list, but the package only ships in the docker-ce apt repos — on
# Fedora/RHEL dnf, the install aborts with "Unable to find a match:
# docker-model-plugin". We add the repo and install the core packages
# explicitly to avoid that.
if ! command -v docker &> /dev/null; then
    print_info "Installing Docker..."

    if [ "$OS_FAMILY" = "fedora" ]; then
        dnf install -y dnf-plugins-core
        dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
        dnf install -y docker-ce docker-ce-cli containerd.io \
            docker-compose-plugin docker-buildx-plugin
    elif [ "$OS_FAMILY" = "rhel" ]; then
        dnf install -y dnf-plugins-core
        dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
        dnf install -y docker-ce docker-ce-cli containerd.io \
            docker-compose-plugin docker-buildx-plugin
    else
        curl -fsSL https://get.docker.com | sh
    fi

    systemctl enable docker
    systemctl start docker
    print_success "Docker installed"
else
    print_success "Docker already installed"
fi

# Install Docker Compose plugin if not present (Debian/Ubuntu only — the
# RHEL-family install above already pulled it in via the docker-ce repo).
if ! docker compose version &> /dev/null; then
    print_info "Installing Docker Compose..."
    if [ "$OS_FAMILY" = "fedora" ] || [ "$OS_FAMILY" = "rhel" ]; then
        dnf install -y docker-compose-plugin
    else
        apt-get install -y docker-compose-plugin
    fi
    print_success "Docker Compose installed"
else
    print_success "Docker Compose already installed"
fi

# Install Node.js for frontend build (builds on host to avoid Docker memory issues)
if ! command -v node &> /dev/null; then
    print_info "Installing Node.js..."
    if [ "$OS_FAMILY" = "fedora" ] || [ "$OS_FAMILY" = "rhel" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        dnf install -y nodejs
    else
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    fi
    print_success "Node.js $(node --version) installed"
else
    print_success "Node.js $(node --version) already installed"
fi

# Clone or update repository
print_info "Installing ServerKit to $INSTALL_DIR..."

if [ -d "$INSTALL_DIR" ]; then
    print_warning "Directory exists, updating..."
    cd "$INSTALL_DIR"
    git fetch origin
    git reset --hard origin/main
else
    git clone https://github.com/jhd3197/serverkit.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

print_success "Repository cloned"

# Create directories
print_info "Creating directories..."
mkdir -p "$LOG_DIR"
mkdir -p "$DATA_DIR"
mkdir -p "$INSTALL_DIR/backend/instance"
mkdir -p "$INSTALL_DIR/nginx/ssl"
mkdir -p /etc/serverkit/templates
mkdir -p /var/serverkit/apps

# Copy bundled templates to system directory
print_info "Installing app templates..."
if [ -d "$INSTALL_DIR/backend/templates" ]; then
    cp -r "$INSTALL_DIR/backend/templates/"*.yaml /etc/serverkit/templates/ 2>/dev/null || true
    cp -r "$INSTALL_DIR/backend/templates/"*.yml /etc/serverkit/templates/ 2>/dev/null || true
    print_success "Installed $(ls /etc/serverkit/templates/*.yaml 2>/dev/null | wc -l) app templates"
fi

# Set up Python virtual environment
print_info "Setting up Python virtual environment..."
$PYTHON_BIN -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

# Install Python dependencies
print_info "Installing Python dependencies..."
pip install --upgrade pip
if [ "$SAFE_MODE" = true ]; then
    pip install --no-cache-dir -r "$INSTALL_DIR/backend/requirements.txt"
else
    pip install -r "$INSTALL_DIR/backend/requirements.txt"
fi
pip install gunicorn gevent gevent-websocket

print_success "Python dependencies installed"

# Generate .env if not exists
if [ ! -f "$INSTALL_DIR/.env" ]; then
    print_info "Generating configuration..."
    SECRET_KEY=$(openssl rand -hex 32)
    JWT_SECRET_KEY=$(openssl rand -hex 32)

    cat > "$INSTALL_DIR/.env" << EOF
# ServerKit Configuration
# Generated on $(date)

# Security Keys (auto-generated, keep secret!)
SECRET_KEY=$SECRET_KEY
JWT_SECRET_KEY=$JWT_SECRET_KEY

# Database (SQLite by default)
DATABASE_URL=sqlite:///$INSTALL_DIR/backend/instance/serverkit.db

# CORS Origins (comma-separated, add your domain)
CORS_ORIGINS=http://localhost,https://localhost

# Ports
PORT=80
SSL_PORT=443

# Environment
FLASK_ENV=production
EOF

    print_success "Configuration generated"
else
    print_warning ".env already exists, keeping existing configuration"
fi

# Generate self-signed SSL certificate if not exists
if [ ! -f "$INSTALL_DIR/nginx/ssl/fullchain.pem" ]; then
    print_info "Generating self-signed SSL certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$INSTALL_DIR/nginx/ssl/privkey.pem" \
        -out "$INSTALL_DIR/nginx/ssl/fullchain.pem" \
        -subj "/CN=localhost" 2>/dev/null
    print_warning "Self-signed certificate created. Replace with real cert for production."
fi

# Install systemd service for backend
print_info "Installing systemd service..."
cp "$INSTALL_DIR/serverkit-backend.service" /etc/systemd/system/serverkit.service

# Reload systemd and enable service
systemctl daemon-reload
systemctl enable serverkit

print_success "Systemd service installed"

# Make CLI executable and create symlink
chmod +x "$INSTALL_DIR/serverkit"
ln -sf "$INSTALL_DIR/serverkit" /usr/local/bin/serverkit

print_success "CLI installed"

# Install and configure host nginx as reverse proxy
print_info "Setting up nginx reverse proxy..."
if [ "$OS_FAMILY" = "fedora" ] || [ "$OS_FAMILY" = "rhel" ]; then
    dnf install -y nginx
else
    apt-get install -y nginx
fi

# Stop nginx and remove default site
systemctl stop nginx 2>/dev/null || true
rm -f /etc/nginx/sites-enabled/default

# Ensure sites directories exist
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled
mkdir -p /etc/nginx/serverkit-locations

# Ensure nginx.conf includes sites-enabled (Fedora uses conf.d by default)
if ! grep -q "sites-enabled" /etc/nginx/nginx.conf; then
    sed -i '/http {/a \    include /etc/nginx/sites-enabled/*;' /etc/nginx/nginx.conf
fi

# Remove any nginx configs that use server_name _ (catch-all) besides serverkit-managed ones
# These conflict with the panel and can allow compromised apps to hijack all traffic
for conf in /etc/nginx/sites-enabled/*; do
    [ -f "$conf" ] || continue
    name=$(basename "$conf")
    # Skip all ServerKit-managed configs
    case "$name" in serverkit-*|serverkit.conf) continue ;; esac
    if grep -Eq 'server_name[[:space:]]+_;' "$conf" 2>/dev/null; then
        print_warning "Removing conflicting catch-all config: $name"
        rm -f "/etc/nginx/sites-enabled/$name"
        rm -f "/etc/nginx/sites-available/$name"
    fi
done

# Install ServerKit site config
cp "$INSTALL_DIR/nginx/sites-available/serverkit.conf" /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/serverkit.conf /etc/nginx/sites-enabled/

# Copy site template
cp "$INSTALL_DIR/nginx/sites-available/example.conf.template" /etc/nginx/sites-available/

# Configure SELinux to allow nginx reverse proxying (Fedora/Rocky/RHEL)
if { [ "$OS_FAMILY" = "fedora" ] || [ "$OS_FAMILY" = "rhel" ]; } && command -v setsebool &> /dev/null; then
    setsebool -P httpd_can_network_connect 1 2>/dev/null || true
fi

print_success "Nginx proxy configured"

# Clean up Docker to prevent issues
print_info "Cleaning up Docker..."
docker network prune -f 2>/dev/null || true
docker container prune -f 2>/dev/null || true

# Ensure swap exists for low-RAM VPS servers (Vite build needs ~512MB+)
setup_swap

# Build frontend on host (avoids Docker memory overhead on low-RAM VPS)
print_info "Building frontend..."
cd "$INSTALL_DIR/frontend"
npm ci --prefer-offline 2>&1 | tail -1
NODE_OPTIONS="--max-old-space-size=1024" npm run build
print_success "Frontend built"

# Package frontend into nginx container
print_info "Building frontend container..."
cd "$INSTALL_DIR"
docker compose build

print_info "Starting services..."

# Start backend (systemd)
systemctl start serverkit

# Start frontend (Docker)
docker compose up -d

# Start nginx
systemctl start nginx
systemctl enable nginx

# Wait for services to start
print_info "Waiting for services to start..."
sleep 10

# Health check
echo ""
BACKEND_OK=false
FRONTEND_OK=false

if curl -s http://127.0.0.1:5000/api/v1/system/health > /dev/null 2>&1; then
    BACKEND_OK=true
    print_success "Backend is running"
else
    print_error "Backend health check failed"
fi

if curl -s http://localhost > /dev/null 2>&1; then
    FRONTEND_OK=true
    print_success "Frontend is running"
else
    print_error "Frontend health check failed"
fi

echo ""
if [ "$BACKEND_OK" = true ] && [ "$FRONTEND_OK" = true ]; then
    # Track successful install
    INSTALLED_VERSION=$(cat "$INSTALL_DIR/VERSION" 2>/dev/null | tr -d '\n\r ')
    curl -s "https://serverkit.ai/track/install?v=${INSTALLED_VERSION}" >/dev/null 2>&1 || true

    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  Installation Complete!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "ServerKit is now running at: http://localhost"
    echo ""
    echo "Quick Start:"
    echo "  1. Create admin user:  serverkit create-admin"
    echo "  2. View status:        serverkit status"
    echo "  3. View logs:          serverkit logs"
    echo ""
    echo "Service Management:"
    echo "  Backend (systemd):     systemctl [start|stop|restart] serverkit"
    echo "  Frontend (Docker):     docker compose --project-directory $INSTALL_DIR [up|down]"
    echo ""
    echo "For all commands:        serverkit help"
    echo ""
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}  Installation may have issues${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  Backend logs:   journalctl -u serverkit -f"
    echo "  Frontend logs:  docker compose --project-directory $INSTALL_DIR logs -f"
    echo ""
fi
