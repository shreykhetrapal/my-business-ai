#!/bin/zsh
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
label="com.my-business-ai.cloudflared"
launch_agents_dir="$HOME/Library/LaunchAgents"
uid="$(id -u)"
dest="$launch_agents_dir/$label.plist"
tunnel_name="my-business-ai-local"

token="$(/opt/homebrew/bin/cloudflared tunnel token "$tunnel_name" 2>/tmp/my-business-ai-cloudflared-token.err | tail -n 1)"
if [[ -z "$token" ]]; then
  cat /tmp/my-business-ai-cloudflared-token.err >&2 || true
  echo "Could not fetch Cloudflare tunnel token for $tunnel_name"
  exit 1
fi

mkdir -p "$launch_agents_dir"
cat > "$dest" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>

  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/cloudflared</string>
    <string>tunnel</string>
    <string>run</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>TUNNEL_TOKEN</key>
    <string>$token</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/tmp/my-business-ai-cloudflared.log</string>

  <key>StandardErrorPath</key>
  <string>/tmp/my-business-ai-cloudflared.err</string>
</dict>
</plist>
PLIST
chmod 600 "$dest"

launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$dest"
launchctl enable "gui/$uid/$label"
launchctl kickstart -k "gui/$uid/$label"

echo "Installed and started $label"
echo "Tunnel: $tunnel_name"
echo "Logs:"
echo "- /tmp/my-business-ai-cloudflared.log"
echo "- /tmp/my-business-ai-cloudflared.err"
