#!/usr/bin/env bash
# Installs the Excalidraw Mirror Plugin into an Obsidian vault.
#
# Usage:
#   ./install.sh /path/to/YourVault
#   ./install.sh /path/to/YourVault --no-build
#
# The vault must already exist and contain a .obsidian folder.
# Open the vault once in Obsidian if it does not.

set -euo pipefail

VAULT="${1:-}"
NO_BUILD="${2:-}"

if [ -z "$VAULT" ]; then
	echo "Usage: $0 /path/to/YourVault [--no-build]"
	exit 1
fi

if [ ! -d "$VAULT/.obsidian" ]; then
	echo "Error: $VAULT does not look like an Obsidian vault (no .obsidian folder found)."
	echo "Open the folder once in Obsidian, then run this script again."
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ "$NO_BUILD" != "--no-build" ]; then
	if command -v npm >/dev/null 2>&1; then
		if [ ! -d node_modules ]; then
			echo "Installing build dependencies with npm..."
			npm install --silent
		fi
		echo "Building the plugin with esbuild..."
		npm run build
	else
		echo "npm was not found."
		if [ ! -f main.js ]; then
			echo "No prebuilt main.js found. Copying src/main.js as main.js."
			cp src/main.js main.js
		else
			echo "Using the existing prebuilt main.js."
		fi
	fi
fi

if [ ! -f main.js ]; then
	echo "Error: main.js is missing. Run npm install and npm run build first."
	exit 1
fi

DEST="$VAULT/.obsidian/plugins/excalidraw-mirror-plugin"
mkdir -p "$DEST"
cp main.js manifest.json styles.css "$DEST/"
if [ -f versions.json ]; then
	cp versions.json "$DEST/"
fi

echo
echo "Installed Excalidraw Mirror Plugin to:"
echo "  $DEST"
echo
echo "Next steps in Obsidian:"
echo "  1. Settings -> Community plugins -> make sure Restricted mode is off."
echo "  2. Click the reload icon next to Installed plugins."
echo "  3. Enable 'Excalidraw Mirror Plugin'."
