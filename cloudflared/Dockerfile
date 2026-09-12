FROM alpine:3.20

RUN apk add --no-cache curl bash ca-certificates \
    && ARCH="$(uname -m)" \
    && case "$ARCH" in \
         x86_64) CF_ARCH="amd64" ;; \
         aarch64) CF_ARCH="arm64" ;; \
         armv7l) CF_ARCH="arm" ;; \
         *) echo "Unsupported arch: $ARCH" && exit 1 ;; \
       esac \
    && curl -fsSL -o /usr/local/bin/cloudflared \
         "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
    && chmod +x /usr/local/bin/cloudflared

WORKDIR /root/.cloudflared

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Before setup (no config.yml present): idles so you can shell in
# (`docker compose exec cloudflared sh`) and run the interactive
# login/create/route commands.
# After setup (config.yml present): runs `cloudflared tunnel run` as PID 1,
# actively forwarding traffic to the middleware. See entrypoint.sh.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
