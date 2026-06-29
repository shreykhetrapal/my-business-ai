#!/bin/zsh
set -euo pipefail

uid="$(id -u)"
services=(
  "com.my-business-ai.app"
  "com.my-business-ai.cloudflared"
)

for label in "${services[@]}"; do
  if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
    echo "$label: loaded"
  else
    echo "$label: not loaded"
  fi
done

echo
echo "Processes:"
pgrep -fl "src/server.js|cloudflared" | sed -E 's/(--token )[A-Za-z0-9._=-]+/\1[redacted]/g' || true

echo
echo "Health checks:"
if curl -fsS --max-time 5 http://127.0.0.1:5174/api/auth/status >/dev/null; then
  echo "app: ok at http://127.0.0.1:5174"
else
  echo "app: not reachable at http://127.0.0.1:5174"
fi

echo
echo "Recent tunnel logs:"
for file in \
  /tmp/my-business-ai-app.err \
  /tmp/my-business-ai-cloudflared.log \
  /tmp/my-business-ai-cloudflared.err; do
  echo "--- $file"
  if [[ -f "$file" ]]; then
    tail -n 10 "$file"
  else
    echo "missing"
  fi
done
