#!/bin/bash
# Sockt installation script
# Usage: curl -fsSL https://sockt.dev/install | bash

set -e

# Configuration
VERSION="${VERSION:-latest}"
INSTALL_DIR="${SOCKT_INSTALL_DIR:-$HOME/.local/bin}"
REPO="sockt-dev/sockt"
PLATFORM=""
ARCH=""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Flags
NO_BUN=false
NO_DOCKER=false
NO_PATH=false
UNINSTALL=false

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --version)
                VERSION="$2"
                shift 2
                ;;
            --dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            --no-bun)
                NO_BUN=true
                shift
                ;;
            --no-docker)
                NO_DOCKER=true
                shift
                ;;
            --no-path)
                NO_PATH=true
                shift
                ;;
            --uninstall)
                UNINSTALL=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                echo -e "${RED}Error: Unknown option: $1${NC}" >&2
                show_help
                exit 1
                ;;
        esac
    done
}

show_help() {
    cat << EOF
Sockt Installation Script

Usage: $0 [OPTIONS]

Options:
  --version VERSION    Install specific version (default: latest)
  --dir DIR           Installation directory (default: ~/.local/bin)
  --no-bun            Skip Bun installation prompt (fail if not found)
  --no-docker         Skip Docker checks entirely
  --no-path           Don't modify shell configuration
  --uninstall         Remove sockt installation
  --help              Show this help message

Environment variables:
  VERSION             Version to install (same as --version)
  SOCKT_INSTALL_DIR   Installation directory (same as --dir)

Examples:
  # Install latest version
  curl -fsSL https://sockt.dev/install | bash

  # Install specific version
  VERSION=0.1.0 curl -fsSL https://sockt.dev/install | bash

  # Install to custom directory
  SOCKT_INSTALL_DIR=/usr/local/bin curl -fsSL https://sockt.dev/install | bash

  # Uninstall
  curl -fsSL https://sockt.dev/install | bash -s -- --uninstall

EOF
}

detect_platform() {
    echo -e "${BLUE}Detecting platform...${NC}"

    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

    case "$OS" in
        linux)
            PLATFORM="linux"
            ;;
        darwin)
            PLATFORM="darwin"
            ;;
        mingw*|msys*|cygwin*)
            echo -e "${RED}❌ Windows is not directly supported${NC}"
            echo "Please use WSL2: https://docs.microsoft.com/en-us/windows/wsl/install"
            exit 5
            ;;
        *)
            echo -e "${RED}❌ Unsupported OS: $OS${NC}"
            exit 5
            ;;
    esac

    case "$ARCH" in
        x86_64|amd64)
            ARCH="x86_64"
            ;;
        aarch64|arm64)
            ARCH="aarch64"
            ;;
        *)
            echo -e "${RED}❌ Unsupported architecture: $ARCH${NC}"
            exit 5
            ;;
    esac

    echo "Detected platform: $PLATFORM-$ARCH"
}

check_prerequisites() {
    echo -e "\n${BLUE}Checking prerequisites...${NC}"

    # Check for curl or wget
    if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
        echo -e "${RED}❌ Neither curl nor wget found${NC}"
        echo "Please install curl or wget first"
        exit 2
    fi

    # Check for tar
    if ! command -v tar &> /dev/null; then
        echo -e "${RED}❌ tar not found${NC}"
        echo "Please install tar first"
        exit 2
    fi
}

install_bun_if_needed() {
    echo -e "\n${BLUE}Checking Bun runtime...${NC}"

    if ! command -v bun &> /dev/null; then
        if [ "$NO_BUN" = true ]; then
            echo -e "${RED}❌ Bun not found (--no-bun specified)${NC}"
            echo "Install Bun: https://bun.sh"
            exit 2
        fi

        echo -e "${YELLOW}⚠ Bun runtime not found${NC}"
        echo "Sockt requires Bun to run TypeScript services."
        echo ""
        read -p "Install Bun now? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            echo "Installing Bun..."
            if ! curl -fsSL https://bun.sh/install | bash; then
                echo -e "${RED}❌ Bun installation failed${NC}"
                exit 2
            fi

            # Source Bun installation to get it in PATH
            export BUN_INSTALL="$HOME/.bun"
            export PATH="$BUN_INSTALL/bin:$PATH"

            # Verify installation
            if ! command -v bun &> /dev/null; then
                echo -e "${RED}❌ Bun installation failed${NC}"
                echo "Please install manually: https://bun.sh"
                exit 2
            fi

            BUN_VERSION=$(bun --version)
            echo -e "${GREEN}✓ Bun v${BUN_VERSION} installed${NC}"
        else
            echo -e "${RED}❌ Bun is required. Installation cancelled.${NC}"
            exit 1
        fi
    else
        BUN_VERSION=$(bun --version)
        echo -e "${GREEN}✓ Bun v${BUN_VERSION} detected${NC}"
    fi
}

check_docker() {
    if [ "$NO_DOCKER" = true ]; then
        return
    fi

    echo -e "\n${BLUE}Checking Docker...${NC}"

    if ! command -v docker &> /dev/null; then
        echo -e "${YELLOW}⚠ Docker not found${NC}"
        echo "Docker is required to run sockt services."
        echo ""
        echo "Install Docker:"
        echo "  macOS:  https://docs.docker.com/desktop/install/mac-install/"
        echo "  Linux:  https://docs.docker.com/engine/install/"
        echo ""
        read -p "Continue without Docker? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled."
            exit 1
        fi
        return
    fi

    # Check if daemon is running
    if ! docker ps &> /dev/null 2>&1; then
        echo -e "${YELLOW}⚠ Docker daemon not running${NC}"
        echo "Start Docker before running 'sockt deploy'"
    else
        DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | cut -d',' -f1)
        echo -e "${GREEN}✓ Docker v${DOCKER_VERSION} detected${NC}"
    fi
}

download_and_install() {
    echo -e "\n${BLUE}Downloading sockt ${VERSION}...${NC}"

    # Determine version URL
    if [ "$VERSION" = "latest" ]; then
        DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/sockt-${PLATFORM}-${ARCH}.tar.gz"
    else
        DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/sockt-${PLATFORM}-${ARCH}.tar.gz"
    fi

    # Create temp directory
    TMP_DIR=$(mktemp -d)
    trap "rm -rf $TMP_DIR" EXIT

    # Download
    echo "Downloading from: $DOWNLOAD_URL"
    if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/sockt.tar.gz"; then
        echo -e "${RED}❌ Download failed${NC}"
        echo "Please check:"
        echo "  - Your internet connection"
        echo "  - That version ${VERSION} exists"
        echo "  - That a binary is available for ${PLATFORM}-${ARCH}"
        exit 3
    fi

    # TODO: Verify checksum if SHA256SUMS available
    # For now, we'll skip checksum verification

    # Extract
    echo "Extracting..."
    if ! tar -xzf "$TMP_DIR/sockt.tar.gz" -C "$TMP_DIR"; then
        echo -e "${RED}❌ Extraction failed${NC}"
        exit 4
    fi

    # Create install directory if needed
    if [ ! -d "$INSTALL_DIR" ]; then
        echo "Creating installation directory: $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi

    # Backup existing binary
    if [ -f "$INSTALL_DIR/sockt" ]; then
        echo "Backing up existing binary..."
        mv "$INSTALL_DIR/sockt" "$INSTALL_DIR/sockt.backup"
    fi

    # Install
    if ! mv "$TMP_DIR/sockt" "$INSTALL_DIR/sockt"; then
        echo -e "${RED}❌ Installation failed${NC}"
        echo "Could not move binary to $INSTALL_DIR"
        # Restore backup if it exists
        if [ -f "$INSTALL_DIR/sockt.backup" ]; then
            mv "$INSTALL_DIR/sockt.backup" "$INSTALL_DIR/sockt"
        fi
        exit 4
    fi

    chmod +x "$INSTALL_DIR/sockt"

    echo -e "${GREEN}✓ Installed to $INSTALL_DIR/sockt${NC}"
}

setup_path() {
    if [ "$NO_PATH" = true ]; then
        return
    fi

    # Check if INSTALL_DIR is in PATH
    if echo "$PATH" | grep -q "$INSTALL_DIR"; then
        return
    fi

    echo -e "\n${YELLOW}⚠ $INSTALL_DIR is not in your PATH${NC}"

    # Detect shell
    SHELL_NAME=$(basename "$SHELL")
    case "$SHELL_NAME" in
        bash)
            if [ "$(uname)" = "Darwin" ]; then
                RC_FILE="$HOME/.bash_profile"
            else
                RC_FILE="$HOME/.bashrc"
            fi
            ;;
        zsh)
            RC_FILE="$HOME/.zshrc"
            ;;
        *)
            echo "Detected shell: $SHELL_NAME"
            echo "Please add $INSTALL_DIR to your PATH manually:"
            echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
            return
            ;;
    esac

    read -p "Add $INSTALL_DIR to PATH in $RC_FILE? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
        echo "" >> "$RC_FILE"
        echo "# Added by sockt installer" >> "$RC_FILE"
        echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$RC_FILE"
        echo -e "${GREEN}✓ Added to PATH in $RC_FILE${NC}"
        echo ""
        echo "Run: source $RC_FILE"
        echo "Or restart your shell"
    fi
}

verify_installation() {
    echo -e "\n${BLUE}Verifying installation...${NC}"

    if ! "$INSTALL_DIR/sockt" --version &> /dev/null; then
        echo -e "${RED}❌ Installation verification failed${NC}"
        exit 4
    fi

    INSTALLED_VERSION=$("$INSTALL_DIR/sockt" --version 2>&1 | head -1)
    echo -e "${GREEN}✓ ${INSTALLED_VERSION}${NC}"
}

run_doctor() {
    echo -e "\n${BLUE}Running health check...${NC}"
    echo ""

    # Run sockt doctor (may fail if config not set up yet, which is OK)
    "$INSTALL_DIR/sockt" doctor 2>&1 || true
}

print_next_steps() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}✓ Installation complete!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Initialize your deployment:"
    echo -e "     ${BLUE}sockt init${NC}"
    echo ""
    echo "  2. Deploy your agent swarm:"
    echo -e "     ${BLUE}sockt deploy${NC}"
    echo ""
    echo "For help: sockt --help"
    echo "Documentation: https://docs.sockt.dev"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

uninstall() {
    echo -e "${BLUE}Uninstalling sockt...${NC}"
    echo ""

    # Remove binary
    if [ -f "$INSTALL_DIR/sockt" ]; then
        rm "$INSTALL_DIR/sockt"
        echo -e "${GREEN}✓ Removed binary from $INSTALL_DIR${NC}"
    else
        echo "Binary not found at $INSTALL_DIR/sockt"
    fi

    # Remove backup if it exists
    if [ -f "$INSTALL_DIR/sockt.backup" ]; then
        rm "$INSTALL_DIR/sockt.backup"
        echo -e "${GREEN}✓ Removed backup binary${NC}"
    fi

    # Ask about config
    if [ -d "$HOME/.sockt" ]; then
        echo ""
        read -p "Remove configuration and data at ~/.sockt? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "$HOME/.sockt"
            echo -e "${GREEN}✓ Removed ~/.sockt${NC}"
        else
            echo "Kept ~/.sockt (config and data preserved)"
        fi
    fi

    echo ""
    echo -e "${GREEN}Uninstallation complete${NC}"
    echo ""
    echo "Note: PATH modifications in shell config were not removed."
    echo "Please edit your ~/.bashrc or ~/.zshrc manually to remove:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
}

main() {
    # Check if running as root (not recommended)
    if [ "$EUID" -eq 0 ]; then
        echo -e "${YELLOW}⚠ Warning: Running as root is not recommended${NC}"
        echo "Sockt should be installed as a regular user."
        echo ""
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi

    parse_args "$@"

    if [ "$UNINSTALL" = true ]; then
        uninstall
        exit 0
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Sockt Installation"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    detect_platform
    check_prerequisites
    install_bun_if_needed
    check_docker
    download_and_install
    setup_path
    verify_installation
    run_doctor
    print_next_steps
}

main "$@"
