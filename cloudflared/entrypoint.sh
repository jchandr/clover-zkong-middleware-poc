#!/bin/sh
set -e

if [ -n "$TUNNEL_TOKEN" ]; then
  echo "[cloudflared] TUNNEL_TOKEN set -- starting tunnel."
  exec cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"
fi

echo "[cloudflared] No TUNNEL_TOKEN set. Idling for setup."
echo "[cloudflared]   1. Create tunnel in dash.cloudflare.com → Networks → Tunnels"
echo "[cloudflared]   2. Copy its token (Configure → Copy token)"
echo "[cloudflared]   3. Set TUNNEL_TOKEN in cloudflared/.env (see cloudflared/.env.example)"
echo "[cloudflared]   4. Restart: docker compose restart cloudflared"
exec tail -f /dev/null
