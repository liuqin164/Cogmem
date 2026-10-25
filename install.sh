#!/usr/bin/env bash
# The Cogmem installer.
#
# It installs the package, links the CLI and stops. It never runs the setup
# wizard and never writes config: setup is `cogmem init`, verification is
# `cogmem doctor`. Both are named at the end, one per Install path, so a person
# and an agent each get the command they should run next. See ADR-0003.
set -euo pipefail

INSTALL_HOME="${COGMEM_INSTALL_HOME:-$HOME/.cogmem/pkg}"
BIN_DIR="${COGMEM_BIN_DIR:-$HOME/.bun/bin}"
PACKAGE_SPEC="${COGMEM_PACKAGE_SPEC:-${COGMEM_NPM_SPEC:-${COGMEM_RELEASE_TARBALL:-latest}}}"

log() {
  printf 'cogmem: %s\n' "$*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_bun() {
  if need_cmd bun; then
    return
  fi

  log "Bun was not found; installing Bun for the current user."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! need_cmd bun; then
    log "Bun install finished but bun is still not on PATH."
    log "Add $HOME/.bun/bin to PATH and rerun this installer."
    exit 1
  fi
}

ensure_install_home() {
  mkdir -p "$INSTALL_HOME"
  if [ ! -f "$INSTALL_HOME/package.json" ]; then
    printf '{"private":true,"dependencies":{}}\n' > "$INSTALL_HOME/package.json"
  fi
}

link_cli() {
  mkdir -p "$BIN_DIR"
  local target="$INSTALL_HOME/node_modules/.bin/cogmem"
  if [ ! -x "$target" ]; then
    log "Installed package did not expose $target."
    exit 1
  fi
  for bin in "$INSTALL_HOME"/node_modules/.bin/cogmem*; do
    if [ -x "$bin" ]; then
      ln -sf "$bin" "$BIN_DIR/$(basename "$bin")"
    fi
  done
  log "Installed CLI: $BIN_DIR/cogmem"
}

on_path() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Print the two Install paths and the gate.
#
# The step list lives in the CLI, not here: the installer asks the install gate
# rather than keeping a second copy of the wording. The fallback only runs when
# the freshly installed CLI cannot start, which is itself a broken install.
print_next_steps() {
  local cli="$BIN_DIR/cogmem"

  if ! on_path "$BIN_DIR"; then
    log "Warning: $BIN_DIR is not on PATH, so 'cogmem' will not resolve yet."
    log "  Fix it for this shell:  export PATH=\"$BIN_DIR:\$PATH\""
    log "  Or call the CLI by absolute path:  $cli"
    log "  The install gate reports this as a WARN, not a failure."
    printf '\n'
  fi

  printf '\n'
  if "$cli" doctor; then
    return
  fi

  log "The installed CLI did not start, so its step list could not be printed."
  log "Try:  $cli doctor"
  printf '\n'
  log "Cogmem is installed. Setup is a separate step; run the CLI to see its steps:"
  log "  $cli doctor"
  printf '\n'
}

main() {
  # Accepted and ignored, so existing scripts that set it keep running. The
  # installer no longer runs the wizard, so there is nothing left to skip.
  if [ "${COGMEM_SKIP_INIT:-}" != "" ]; then
    log "COGMEM_SKIP_INIT is set and ignored: setup is always a separate step now."
  fi

  ensure_bun
  ensure_install_home

  log "Installing cogmem@$PACKAGE_SPEC from npm-compatible package resolution."
  (
    cd "$INSTALL_HOME"
    bun add "cogmem@$PACKAGE_SPEC"
  )
  link_cli

  log "Installed package home: $INSTALL_HOME"
  print_next_steps
}

main "$@"
