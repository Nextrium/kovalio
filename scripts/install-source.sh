#!/bin/sh
# Kovalio FROM-SOURCE installer — https://get.kovalio.nextrium.org/dev
#
#   curl -fsSL https://get.kovalio.nextrium.org/dev | sh
#
# Builds the Kovalio CLI from a git checkout (the same way `bun dev` does) and
# installs it as a SEPARATE `kovalio-dev` command that runs fully isolated from
# a production `kovalio`:
#
#   - its own home           $HOME/.kovalio-dev   (data, tokens, ports, logs)
#   - its own boot service    io.kovalio-dev / kovalio-dev / KovalioDev
#   - the production `kovalio` (npm) is never touched
#
# This is a DEV / PREVIEW build: unverified (no signed release asset), and
# compiling the dashboard needs real RAM/CPU (small boxes can OOM). Update later
# with `kovalio-dev update` (pulls latest source + rebuilds — no npm release
# needed). Remove with:  rm -f "$(command -v kovalio-dev)" && rm -rf ~/.kovalio-dev
#
# Env overrides:
#   KOVALIO_REPO=<git url>     default: https://github.com/Nextrium/kovalio.git
#   KOVALIO_REF=<branch|tag>   default: main
#   KOVALIO_HOME=<dir>         default: $HOME/.kovalio-dev
#   KOVALIO_SRC_DIR=<dir>      default: $KOVALIO_HOME/cli-src
set -eu

info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
err()  { printf '\033[31merror:\033[0m %s\n' "$1" >&2; }

command -v curl >/dev/null 2>&1 || { err "curl is required"; exit 1; }

REPO="${KOVALIO_REPO:-https://github.com/Nextrium/kovalio.git}"
REF="${KOVALIO_REF:-main}"
KOVALIO_HOME="${KOVALIO_HOME:-$HOME/.kovalio-dev}"
SRC_DIR="${KOVALIO_SRC_DIR:-$KOVALIO_HOME/cli-src}"

# 1. Ensure Bun (the runtime + builder). Installs to ~/.bun by default; no Node/npm.
if ! command -v bun >/dev/null 2>&1; then
  # Bun's installer unpacks a .zip, so it needs `unzip` — minimal server images
  # don't ship it. Install it first via whatever package manager is present.
  if ! command -v unzip >/dev/null 2>&1; then
    info "Installing unzip (required by the Bun installer)…"
    SUDO=""
    if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
    if command -v apt-get >/dev/null 2>&1; then
      $SUDO apt-get update -y || true
      $SUDO apt-get install -y unzip || true
    elif command -v dnf >/dev/null 2>&1; then
      $SUDO dnf install -y unzip || true
    elif command -v yum >/dev/null 2>&1; then
      $SUDO yum install -y unzip || true
    elif command -v apk >/dev/null 2>&1; then
      $SUDO apk add --no-cache unzip || true
    elif command -v pacman >/dev/null 2>&1; then
      $SUDO pacman -Sy --noconfirm unzip || true
    elif command -v zypper >/dev/null 2>&1; then
      $SUDO zypper install -y unzip || true
    fi
    command -v unzip >/dev/null 2>&1 || {
      err "unzip is required to install Bun but couldn't be installed automatically. Install it (e.g. 'apt-get install unzip') and re-run."
      exit 1
    }
  fi

  info "Installing the Bun runtime…"
  curl -fsSL https://bun.sh/install | bash
  BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export BUN_INSTALL
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

command -v bun >/dev/null 2>&1 || {
  err "Bun install finished but 'bun' is not on PATH. Open a new shell and re-run."
  exit 1
}

# 2. Ensure git (needed to clone/update the source checkout).
command -v git >/dev/null 2>&1 || {
  err "git is required to install from source. Install it (e.g. 'apt-get install git') and re-run."
  exit 1
}

# 3. Clone or update the checkout at the requested ref.
if [ -d "$SRC_DIR/.git" ]; then
  info "Updating existing checkout at $SRC_DIR ($REF)…"
else
  info "Cloning $REPO → $SRC_DIR…"
  mkdir -p "$(dirname "$SRC_DIR")"
  git clone "$REPO" "$SRC_DIR"
fi
git -C "$SRC_DIR" fetch origin "$REF" --tags
git -C "$SRC_DIR" checkout "$REF"
# Fast-forward a branch to the remote tip; a pinned tag/sha stays put.
git -C "$SRC_DIR" pull --ff-only origin "$REF" 2>/dev/null || info "(pinned ref — not fast-forwarding)"

# 4. Build the CLI like `bun dev` (tsup + bundled server, then the dashboard).
info "Installing workspace dependencies (bun install)…"
( cd "$SRC_DIR" && bun install )
info "Building the CLI (tsup + server bundle)…"
( cd "$SRC_DIR/apps/cli" && bun run build )
info "Building the dashboard (compiles Next — needs RAM/CPU; small boxes can OOM)…"
( cd "$SRC_DIR/apps/cli" && bun run build/stage-dashboard.ts )

ENTRY="$SRC_DIR/apps/cli/dist/index.js"
DASH="$SRC_DIR/apps/dashboard/.next/standalone"
[ -f "$ENTRY" ] || { err "Build produced no CLI at $ENTRY"; exit 1; }
[ -f "$DASH/apps/dashboard/server.js" ] || { err "Build produced no dashboard at $DASH/apps/dashboard/server.js"; exit 1; }

# 5. Wire the `kovalio-dev` launcher: run the built CLI under Bun with the dev
#    home + locally-built dashboard baked in. A separate name + home means the
#    production `kovalio` (and its ~/.kovalio state) are never touched.
BUN_PATH="$(command -v bun)"
BIN="${BUN_INSTALL:-$HOME/.bun}/bin"
[ -d "$BIN" ] || BIN="$HOME/.local/bin"
mkdir -p "$BIN"
rm -f "$BIN/kovalio-dev"
printf '#!/bin/sh\nexport KOVALIO_HOME="%s"\nexport KOVALIO_DASHBOARD_DIR="%s"\nexec "%s" "%s" "$@"\n' \
  "$KOVALIO_HOME" "$DASH" "$BUN_PATH" "$ENTRY" > "$BIN/kovalio-dev"
chmod +x "$BIN/kovalio-dev"

# 6. Write the source-install marker under the DEV home. Its presence flips
#    `kovalio-dev update` to the git-pull + rebuild path (no npm release).
mkdir -p "$KOVALIO_HOME"
cat > "$KOVALIO_HOME/source-install.json" <<EOF
{
  "repo": "$REPO",
  "ref": "$REF",
  "dir": "$SRC_DIR"
}
EOF

# 7. Next steps.
cat <<EOF

$(printf '\033[32m✔\033[0m') Kovalio installed from source ($REF) as $(printf '\033[1mkovalio-dev\033[0m').

  kovalio-dev            # set up + run (interactive) — isolated dev instance
  kovalio-dev up         # run locally with defaults
  kovalio-dev update     # pull latest source + rebuild (no npm release needed)

  Home:    $KOVALIO_HOME   (separate from production ~/.kovalio)
  Source:  $SRC_DIR

Remove it:  rm -f "$BIN/kovalio-dev" && rm -rf "$KOVALIO_HOME"

If 'kovalio-dev' isn't found, add the bin dir to your PATH:
  export PATH="$BIN:\$PATH"
EOF
