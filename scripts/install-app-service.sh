#!/bin/zsh
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
label="com.my-business-ai.app"
launch_agents_dir="$HOME/Library/LaunchAgents"
uid="$(id -u)"
src="$repo_dir/ops/$label.plist"
dest="$launch_agents_dir/$label.plist"

if [[ ! -f "$src" ]]; then
  echo "Missing $src"
  exit 1
fi

mkdir -p "$launch_agents_dir"
cp "$src" "$dest"

launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$dest"
launchctl enable "gui/$uid/$label"
launchctl kickstart -k "gui/$uid/$label"

echo "Installed and started $label"
echo "App: http://127.0.0.1:5174"
echo "Logs:"
echo "- /tmp/my-business-ai-app.log"
echo "- /tmp/my-business-ai-app.err"
