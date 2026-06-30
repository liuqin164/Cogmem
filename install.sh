#!/usr/bin/env bash
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
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      log "Warning: $BIN_DIR is not on PATH. Add it to PATH or run $BIN_DIR/cogmem directly."
      ;;
  esac
}

main() {
  ensure_bun
  ensure_install_home

  log "Installing cogmem@$PACKAGE_SPEC from npm-compatible package resolution."
  (
    cd "$INSTALL_HOME"
    bun add "cogmem@$PACKAGE_SPEC"
  )
  link_cli

  log "Installed package home: $INSTALL_HOME"
  log "Run this later to update: cogmem update --yes"

  if [ "${COGMEM_SKIP_INIT:-0}" = "1" ]; then
    log "Skipping init because COGMEM_SKIP_INIT=1."
    exit 0
  fi

  log "Starting interactive setup. Configure an embedding model and a memory-model LLM for Dream Curator."
  # shellcheck disable=SC2086
  if [ -r /dev/tty ]; then
    "$BIN_DIR/cogmem" init ${COGMEM_INIT_ARGS:-} < /dev/tty
  else
    log "No interactive terminal is available. Run cogmem init manually after this installer exits."
    "$BIN_DIR/cogmem" init --yes ${COGMEM_INIT_ARGS:-}
  fi
}

main "$@"
