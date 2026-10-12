#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Deploy the Community Payments proof of concept at https://payments.privacysafe.app,
# with payment.privacysafe.app (a common mistyping) serving the same site.
#
# Run as root on the web server, from the unpacked project:
#   sudo PAY_TO=<receiving Solana wallet> deploy/payments.privacysafe.app.sh
#
# What it does:
#   1. Checks nginx, DNS, Node.js 20+ (installs Node 22 from NodeSource if needed).
#   2. Records the HTTP status of the sites already on this nginx.
#   3. Installs the app in /opt/privacysafe-payments, run by systemd as the
#      privacysafe-payment user, on 127.0.0.1:3077 only.
#   4. Finds the existing Let's Encrypt certificates for both hostnames (it reads every
#      /etc/letsencrypt/live/*/ certificate and matches its names). If one is missing it
#      tries certbot by webroot; if that fails it carries on: a hostname without a
#      certificate is redirected to payments.privacysafe.app instead.
#   5. Backs up /etc/nginx, writes ONE new file for these hostnames (nothing existing is
#      edited), reloads only after `nginx -t` passes, then re-checks every existing site
#      and removes the new file again if any of them changed.
#
# Problems that do not stop the site from working are reported as warnings and listed
# at the end, instead of stopping the script. It stops only when continuing could break
# nginx or leave the site down, and it says what to do.
#
# Re-running is safe: it updates the code and keeps the data, the env file and the
# certificates. `--print-nginx` prints the nginx file it would write, changing nothing.
# No Tor onion service is set up for these hostnames.

set -Eeuo pipefail

PRIMARY="payments.privacysafe.app"
ALIASES=(payment.privacysafe.app)
APP_DIR="/opt/privacysafe-payments"
DATA_DIR="$APP_DIR/data"
ENV_FILE="/etc/privacysafe-payments.env"
SVC_NAME="privacysafe-payments"
SVC_USER="${SVC_USER:-privacysafe-payment}"
APP_PORT="${APP_PORT:-3077}"
ACME_ROOT="/var/www/letsencrypt"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/root/nginx-backup-$STAMP.tar.gz"
EXISTING_HOSTS=(privacysafe.app www.privacysafe.app privacysafe.me privacysafe.gg privacysafe.foundation privacysafe.io profdiggity.com)
ALL_HOSTS=("$PRIMARY" "${ALIASES[@]}")

WARNINGS=()
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ok() { printf '    \033[32m%s\033[0m\n' "$*"; }
warn() { printf '    \033[1;35mWARNING: %s\033[0m\n' "$*"; WARNINGS+=("$*"); }
die() { printf '\n\033[1;31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }
trap 'printf "\n\033[1;31mUnexpected failure at line %s: %s\033[0m\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

# ---------------------------------------------------------------------------
# Certificates. Prints the /etc/letsencrypt/live/<dir> whose certificate covers $1
# and is not expired; prefers a directory named after the host.
# ---------------------------------------------------------------------------
cert_for() {
  local host="$1" dir best=""
  for dir in /etc/letsencrypt/live/*/; do
    dir="${dir%/}"
    [ -f "$dir/fullchain.pem" ] && [ -f "$dir/privkey.pem" ] || continue
    openssl x509 -in "$dir/fullchain.pem" -noout -checkend 0 >/dev/null 2>&1 || continue
    openssl x509 -in "$dir/fullchain.pem" -noout -ext subjectAltName 2>/dev/null | grep -qE "DNS:$host(,|$|[[:space:]])" || continue
    if [ "$(basename "$dir")" = "$host" ]; then echo "$dir"; return 0; fi
    [ -n "$best" ] || best="$dir"
  done
  [ -n "$best" ] && echo "$best"
}

# Filled in by plan_certs: hostname -> certificate directory ("" if none).
declare -A CERT
plan_certs() {
  local h
  for h in "${ALL_HOSTS[@]}"; do CERT[$h]="$(cert_for "$h" || true)"; done
}

# ---------------------------------------------------------------------------
# nginx configuration. Stage "http" answers Let's Encrypt only; stage "https" is final.
# ---------------------------------------------------------------------------
render_nginx() {
  local stage="$1" h
  cat <<EOF
##
# payments.privacysafe.app (and payment.privacysafe.app): PrivacySafe Community
# Payments proof of concept. Written by deploy/payments.privacysafe.app.sh; edits here
# are overwritten on redeploy, so change the script instead.
#
# Reverse proxy to the Node.js app on 127.0.0.1:$APP_PORT (systemd: $SVC_NAME).
#
# Kept tight, without getting in the way of paying or watching:
#   - three route groups, each allowing only the methods the app uses:
#       /api/               GET and POST (offer, session, payment checks, x402)
#       /media/, /videos/   GET only (episode, poster, captions, walkthroughs;
#                           range requests streamed through unbuffered)
#       everything else     GET only (front page, app, its files)
#     HEAD is allowed wherever GET is. Anything else gets 403.
#   - dotfiles never reach the app; request bodies capped at 16 KB.
#   - per-IP request rates and concurrent connections are limited. The limits are sized
#     for a crowd sharing one public address (a booth on event Wi-Fi: about 60 phones
#     opening the app at once, then polling for their payments), and still stop a single
#     client flooding the site. Over the limit gets 429.
#   - short header and body timeouts, so slow or stalled clients are dropped.
#   - X-Forwarded-For is set to the connecting address only, so it can't be spoofed.
#   - the app sends its own Content-Security-Policy (allowing only itself and the
#     privacysafe.click metrics), HSTS, nosniff, Referrer-Policy,
#     Permissions-Policy and Cross-Origin-Opener-Policy; nothing is added here, so
#     no header is sent twice.
#
# Its own zones (payments_*) and no http-level limit_req_status, so nothing here can
# clash with the main site file. No Tor onion service for these hostnames.
##

limit_req_zone \$binary_remote_addr zone=payments_api:10m rate=40r/s;
limit_req_zone \$binary_remote_addr zone=payments_web:10m rate=100r/s;
limit_conn_zone \$binary_remote_addr zone=payments_conn:10m;

upstream privacysafe_payments {
    server 127.0.0.1:$APP_PORT;
    keepalive 16;
}

# --- HTTP: Let's Encrypt challenges, everything else to HTTPS ---
server {
    listen 80;
    listen [::]:80;
    server_tokens off;
    server_name ${ALL_HOSTS[*]};

    location ^~ /.well-known/acme-challenge/ {
        root $ACME_ROOT;
        default_type text/plain;
        try_files \$uri =404;
    }
EOF
  # A hostname without a certificate goes to the primary hostname, which has one.
  if [ "$stage" = "https" ]; then
    for h in "${ALIASES[@]}"; do
      if [ -z "${CERT[$h]:-}" ]; then
        cat <<EOF
    if (\$host = $h) {
        return 301 https://$PRIMARY\$request_uri;
    }
EOF
      fi
    done
  fi
  cat <<EOF
    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
  [ "$stage" = "https" ] || return 0

  # One HTTPS server block per certificate; hostnames sharing a certificate share a block.
  declare -A names_by_cert=()
  local order=()
  for h in "${ALL_HOSTS[@]}"; do
    local c="${CERT[$h]:-}"
    [ -n "$c" ] || continue
    [ -n "${names_by_cert[$c]:-}" ] || order+=("$c")
    names_by_cert[$c]="${names_by_cert[$c]:-} $h"
  done
  local ssl_options="" dhparam=""
  [ -f /etc/letsencrypt/options-ssl-nginx.conf ] && ssl_options="    include /etc/letsencrypt/options-ssl-nginx.conf;"
  [ -f /etc/letsencrypt/ssl-dhparams.pem ] && dhparam="    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
  if [ -z "$ssl_options" ]; then
    ssl_options="    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:payments_ssl:4m;
    ssl_session_timeout 1d;"
  fi
  local c
  for c in "${order[@]}"; do
    cat <<EOF

# --- HTTPS:${names_by_cert[$c]} (certificate $(basename "$c")) ---
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_tokens off;
    server_name${names_by_cert[$c]};

    ssl_certificate $c/fullchain.pem;
    ssl_certificate_key $c/privkey.pem;
$ssl_options
$dhparam

    # Requests: small bodies, short waits for slow or stalled clients.
    client_max_body_size 16k;
    client_body_buffer_size 16k;
    client_header_timeout 10s;
    client_body_timeout 10s;
    keepalive_timeout 30s;
    send_timeout 60s;

    # Per-IP limits, sized for a crowd on one event Wi-Fi address (see the top).
    # Each phone can hold up to 6 connections; 256 covers about 40 phones at once.
    limit_conn payments_conn 256;
    limit_req_status 429;
    limit_conn_status 429;

    # To the app.
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_hide_header X-Powered-By;
    proxy_connect_timeout 5s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;

    # Dotfiles (.env, .git and the like) never reach the app.
    location ~ /\\. {
        return 404;
    }

    # Payment API: offer and session (GET), payment checks, session swap and x402 (POST).
    # x402 payment-required headers can be a few KB, so allow larger response headers.
    location /api/ {
        limit_except GET POST { deny all; }
        limit_req zone=payments_api burst=200 nodelay;
        proxy_buffer_size 16k;
        proxy_buffers 8 16k;
        proxy_pass http://privacysafe_payments;
    }

    # The members episode, its poster and captions, and the walkthrough videos. Streamed
    # with range requests straight through, not buffered to disk; seeking makes bursts.
    location ~ ^/(media|videos)/ {
        limit_except GET { deny all; }
        limit_req zone=payments_web burst=1000 nodelay;
        proxy_buffering off;
        proxy_read_timeout 60s;
        proxy_pass http://privacysafe_payments;
    }

    # The front page, the app, scripts, styles, images, fonts, downloads, /source.
    location / {
        limit_except GET { deny all; }
        limit_req zone=payments_web burst=1000 nodelay;
        proxy_pass http://privacysafe_payments;
    }
}
EOF
  done
}

if [ "${1:-}" = "--print-nginx" ]; then
  plan_certs
  render_nginx "${2:-https}"
  exit 0
fi

# ---------------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "Run as root (sudo)."
[ -f "$SRC_DIR/server.js" ] && [ -f "$SRC_DIR/package.json" ] || die "Run from the unpacked project: deploy/payments.privacysafe.app.sh"
command -v apt-get >/dev/null || die "This script expects Debian or Ubuntu (apt-get)."

say "Checking prerequisites"
command -v nginx >/dev/null || die "nginx is not installed."
if ! nginx -t >/dev/null 2>&1; then
  nginx -t || true
  die "The current nginx configuration does not pass 'nginx -t' (above). Fix that first; nothing was changed."
fi
ok "nginx present and the current configuration is valid"

if [ -d /etc/nginx/sites-available ] && [ -d /etc/nginx/sites-enabled ]; then
  SITE_FILE="/etc/nginx/sites-available/$PRIMARY.conf"
  SITE_LINK="/etc/nginx/sites-enabled/$PRIMARY.conf"
else
  SITE_FILE="/etc/nginx/conf.d/$PRIMARY.conf"
  SITE_LINK=""
fi
# If this site's file already exists under another name (renamed by hand, for example
# payments_privacysafe_app.conf), keep using that file. Writing a second copy would
# define the upstream and the rate-limit zones twice, which nginx refuses.
mapfile -t ours < <(grep -lsE "upstream privacysafe_payments|zone=payments_(perip|api|web)" /etc/nginx/sites-available/* /etc/nginx/conf.d/*.conf 2>/dev/null || true)
if [ "${#ours[@]}" -gt 1 ]; then
  die "This site is defined in more than one nginx file: ${ours[*]}. Keep one (and its sites-enabled link), delete the others, and re-run."
elif [ "${#ours[@]}" -eq 1 ] && [ "${ours[0]}" != "$SITE_FILE" ]; then
  SITE_FILE="${ours[0]}"
  case "$SITE_FILE" in
    /etc/nginx/sites-available/*) SITE_LINK="/etc/nginx/sites-enabled/$(basename "$SITE_FILE")" ;;
    *) SITE_LINK="" ;;
  esac
  ok "Using the existing file for this site: $SITE_FILE"
fi

for h in "${ALL_HOSTS[@]}"; do
  others="$(grep -rlswF -- "$h" /etc/nginx/ 2>/dev/null | grep -vxF -e "$SITE_FILE" ${SITE_LINK:+-e "$SITE_LINK"} || true)"
  if [ -n "$others" ]; then
    warn "$h is also named in: $(echo "$others" | tr '\n' ' ')(for example by 'certbot --nginx'). nginx uses the first definition it reads; if the checks at the end fail, remove $h from that file."
  fi
  if getent ahosts "$h" >/dev/null; then
    ok "$h resolves to: $(getent ahosts "$h" | awk '{print $1}' | sort -u | tr '\n' ' ')"
  else
    warn "$h does not resolve here. Add an A (and AAAA, if the server has IPv6) record pointing at this server."
  fi
done

apt_updated=""
need_pkg() {
  dpkg -s "$1" >/dev/null 2>&1 && return 0
  [ -n "$apt_updated" ] || { apt-get update -qq; apt_updated=1; }
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$1" >/dev/null
}
for pkg in rsync curl ca-certificates openssl; do need_pkg "$pkg"; done
ok "rsync, curl, openssl present"

node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 20 ]; then
  say "Installing Node.js 22 from NodeSource"
  need_pkg gnupg
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
[ "$(node_major)" -ge 20 ] || die "Node.js 20 or newer is required and could not be installed."
NODE_BIN="$(command -v node)"
ok "Node.js $(node -v) at $NODE_BIN"

# ---------------------------------------------------------------------------
say "Recording the status of existing sites (to compare afterwards)"
site_status() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 -k --resolve "$1:443:127.0.0.1" "https://$1/" || true
}
declare -A BEFORE
for h in "${EXISTING_HOSTS[@]}"; do
  BEFORE[$h]="$(site_status "$h")"
  ok "$h -> ${BEFORE[$h]}"
done

# ---------------------------------------------------------------------------
say "Service user $SVC_USER"
if id -u "$SVC_USER" >/dev/null 2>&1; then
  ok "Using the existing user $SVC_USER"
else
  useradd --system --user-group --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SVC_USER"
  ok "Created system user $SVC_USER"
fi
SVC_GROUP="$(id -gn "$SVC_USER")"
if [ "$(getent passwd "$SVC_USER" | cut -d: -f7)" != "/usr/sbin/nologin" ] && [ "$(getent passwd "$SVC_USER" | cut -d: -f7)" != "/bin/false" ]; then
  warn "$SVC_USER has a login shell. A service account does not need one: usermod -s /usr/sbin/nologin $SVC_USER"
fi

say "Installing the app in $APP_DIR"
install -d -m 0755 "$APP_DIR"
rsync -a --delete \
  --exclude node_modules/ --exclude data/ --exclude build/ --exclude .env \
  --exclude design/ --exclude tests/ --exclude tools/ --exclude .git/ \
  "$SRC_DIR/" "$APP_DIR/"
install -d -m 0750 -o "$SVC_USER" -g "$SVC_GROUP" "$DATA_DIR"

cd "$APP_DIR"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm ci --no-audit --no-fund --loglevel=error || die "npm ci failed (above). Check network access to registry.npmjs.org."
npm run build --silent || die "The build failed (above)."
npm prune --omit=dev --no-audit --no-fund --loglevel=error || warn "npm prune failed; development packages were left installed."
rm -rf "$APP_DIR/build"
chown -R root:root "$APP_DIR"
chown -R "$SVC_USER:$SVC_GROUP" "$DATA_DIR"
ok "Built and installed"

# ---------------------------------------------------------------------------
say "Configuration ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  [ -n "${PAY_TO:-}" ] || die "First run needs the receiving wallet: sudo PAY_TO=<Solana address> $0"
  umask 027
  cat > "$ENV_FILE" <<EOF
# PrivacySafe Community Payments: payments.privacysafe.app
# Created by deploy/payments.privacysafe.app.sh on $STAMP. Edit, then: systemctl restart $SVC_NAME
NODE_ENV=production
PORT=$APP_PORT
BIND_ADDRESS=127.0.0.1
TRUST_PROXY=loopback
PAY_TO=$PAY_TO
SESSION_SECRET=$(openssl rand -hex 32)
HOST_IDENTITY=johnkiriakou@privacysafe.me
OFFER_TITLE=Secret Agent Club
OFFER_TARGET=secret-agent-club
ASSETS=USDC,AUDD
PRICE_USDC=1.00
PRICE_AUDD=1.40
ACCESS_HOURS=6
SOURCE_URL=https://github.com/PrivacySafe/privacysafe-payments
# In-app x402 payments. Turn on once a facilitator is configured (see README):
# X402=on
# FACILITATOR_URL=
EOF
  ok "Created with a new SESSION_SECRET"
else
  ok "Kept the existing file"
  grep -q '^PAY_TO=.' "$ENV_FILE" || die "$ENV_FILE has no PAY_TO. Add the receiving Solana wallet and re-run."
  if ! grep -q '^SESSION_SECRET=.' "$ENV_FILE"; then
    echo "SESSION_SECRET=$(openssl rand -hex 32)" >> "$ENV_FILE"; warn "$ENV_FILE had no SESSION_SECRET; a new one was added."
  fi
  grep -q '^BIND_ADDRESS=' "$ENV_FILE" || echo "BIND_ADDRESS=127.0.0.1" >> "$ENV_FILE"
  grep -q '^TRUST_PROXY=' "$ENV_FILE" || echo "TRUST_PROXY=loopback" >> "$ENV_FILE"
  APP_PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2)"
  APP_PORT="${APP_PORT:-3077}"
fi
chown root:"$SVC_GROUP" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

# ---------------------------------------------------------------------------
say "systemd service $SVC_NAME"
if ss -ltnH "sport = :$APP_PORT" 2>/dev/null | grep -q . && ! systemctl is-active --quiet "$SVC_NAME"; then
  die "Port $APP_PORT is in use by something else. Re-run with APP_PORT=<free port>."
fi
cat > "/etc/systemd/system/$SVC_NAME.service" <<EOF
[Unit]
Description=PrivacySafe Community Payments (payments.privacysafe.app)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_GROUP
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN server.js
Restart=on-failure
RestartSec=3

# Hardening: read-only system and app code, writable data directory only.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native
UMask=0027

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --quiet "$SVC_NAME"
systemctl restart "$SVC_NAME"
up=""
for _ in $(seq 60); do
  if curl -fs -o /dev/null "http://127.0.0.1:$APP_PORT/api/offer"; then up=1; break; fi
  sleep 0.5
done
if [ -z "$up" ]; then
  journalctl -u "$SVC_NAME" -n 40 --no-pager || true
  die "The app did not start (log above). nginx was not changed. Common causes: PAY_TO is not a valid Solana address, or the Solana RPC is unreachable."
fi
ok "Running on 127.0.0.1:$APP_PORT"

# ---------------------------------------------------------------------------
say "Certificates"
plan_certs
for h in "${ALL_HOSTS[@]}"; do
  if [ -n "${CERT[$h]}" ]; then
    ok "$h -> ${CERT[$h]} (valid until $(openssl x509 -in "${CERT[$h]}/fullchain.pem" -noout -enddate | cut -d= -f2))"
  fi
done

say "nginx: backing up /etc/nginx to $BACKUP"
tar -czf "$BACKUP" -C / etc/nginx
ok "Backup written"

PREV=""
[ -f "$SITE_FILE" ] && PREV="$(cat "$SITE_FILE")"
rollback() {
  printf '\n\033[1;31mRolling back the %s nginx file.\033[0m\n' "$PRIMARY" >&2
  if [ -n "$PREV" ]; then printf '%s\n' "$PREV" > "$SITE_FILE"; else rm -f "$SITE_FILE" ${SITE_LINK:+"$SITE_LINK"}; fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
}
apply_nginx() {
  render_nginx "$1" > "$SITE_FILE.new"
  mv "$SITE_FILE.new" "$SITE_FILE"
  [ -n "$SITE_LINK" ] && ln -sf "$SITE_FILE" "$SITE_LINK"
  if ! nginx -t; then rollback; die "nginx rejected the new file (above); it was rolled back. Existing sites are unchanged."; fi
  systemctl reload nginx
}

missing=()
for h in "${ALL_HOSTS[@]}"; do [ -n "${CERT[$h]}" ] || missing+=("$h"); done
if [ "${#missing[@]}" -gt 0 ]; then
  say "Requesting certificates for: ${missing[*]}"
  install -d -m 0755 "$ACME_ROOT"
  if need_pkg certbot; then
    apply_nginx http
    email_args=(--register-unsafely-without-email)
    [ -n "${CERTBOT_EMAIL:-}" ] && email_args=(-m "$CERTBOT_EMAIL")
    for h in "${missing[@]}"; do
      if certbot certonly --webroot -w "$ACME_ROOT" -d "$h" --cert-name "$h" --non-interactive --agree-tos "${email_args[@]}" \
           --deploy-hook "systemctl reload nginx"; then
        ok "Certificate issued for $h"
      else
        warn "certbot could not get a certificate for $h. Check its DNS record and that port 80 reaches this server."
      fi
    done
    plan_certs
  else
    warn "certbot is not installed and could not be installed."
  fi
fi
if [ -z "${CERT[$PRIMARY]}" ]; then
  [ -n "$PREV" ] && printf '%s\n' "$PREV" > "$SITE_FILE" || rm -f "$SITE_FILE" ${SITE_LINK:+"$SITE_LINK"}
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  die "There is no valid certificate for $PRIMARY, so HTTPS cannot be served. The app is running; once a certificate exists (for example: certbot certonly --webroot -w $ACME_ROOT -d $PRIMARY -d ${ALIASES[*]}), re-run this script."
fi
for h in "${ALIASES[@]}"; do
  [ -n "${CERT[$h]}" ] || warn "No certificate for $h: it now redirects to https://$PRIMARY. Add one and re-run to serve it directly."
done

say "nginx: enabling HTTPS"
apply_nginx https
ok "Reloaded"

# ---------------------------------------------------------------------------
say "Checking the site"
check_host() {
  local host="$1" path got
  for path in / /app/ /api/offer /robots.txt /llms.txt /img/social-preview.jpg; do
    got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$host:443:127.0.0.1" "https://$host$path" || true)"
    if [ "$got" = "200" ]; then ok "https://$host$path -> 200"; else warn "https://$host$path returned ${got:-nothing} (expected 200)"; fi
  done
  got="$(curl -s -o /dev/null -w '%{http_code}' -r 0-99 --max-time 15 --resolve "$host:443:127.0.0.1" "https://$host/videos/secret-agent-club-desktop-walkthrough.mp4" || true)"
  [ "$got" = 206 ] && ok "https://$host video range request -> 206" || warn "https://$host video range request returned ${got:-nothing} (expected 206)"
  got="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 --resolve "$host:80:127.0.0.1" "http://$host/app/" || true)"
  [[ "$got" == "301 https://$host/app/" ]] && ok "http://$host -> https" || warn "http://$host/app/ answered '$got' (expected a 301 to https://$host/app/)"
  local issuer
  issuer="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$host" 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null | tr '\n' ' ')"
  echo "$issuer" | grep -q "DNS:$host" && ok "$host is served with a certificate that names it" || warn "$host is served with a certificate that does not name it: $issuer"
}
for h in "${ALL_HOSTS[@]}"; do
  if [ -n "${CERT[$h]}" ]; then
    check_host "$h"
  else
    got="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 --resolve "$h:80:127.0.0.1" "http://$h/app/" || true)"
    [[ "$got" == "301 https://$PRIMARY/app/" ]] && ok "http://$h -> https://$PRIMARY" || warn "http://$h/app/ answered '$got'"
  fi
done
hsts="$(curl -sI --max-time 10 --resolve "$PRIMARY:443:127.0.0.1" "https://$PRIMARY/" | grep -ci '^strict-transport-security' || true)"
[ "$hsts" = "1" ] && ok "HSTS sent once (by the app)" || warn "Strict-Transport-Security headers on $PRIMARY: $hsts (expected 1)"

say "Re-checking existing sites"
changed=0
for h in "${EXISTING_HOSTS[@]}"; do
  now="$(site_status "$h")"
  if [ "$now" = "${BEFORE[$h]}" ]; then ok "$h -> $now (unchanged)"; else echo "    $h: ${BEFORE[$h]} before, $now now"; changed=1; fi
done
if [ "$changed" = 1 ]; then
  rollback
  die "An existing site changed status, so the new nginx file was removed again (the app keeps running). Backup: $BACKUP"
fi

# ---------------------------------------------------------------------------
printf '\n\033[1;32mDone: https://%s is live' "$PRIMARY"
for h in "${ALIASES[@]}"; do [ -n "${CERT[$h]}" ] && printf ', and https://%s serves the same site' "$h"; done
printf '.\033[0m\n'
cat <<EOF

  App          $APP_DIR  (systemd: $SVC_NAME, user $SVC_USER, 127.0.0.1:$APP_PORT)
  Config       $ENV_FILE   (then: systemctl restart $SVC_NAME)
  Data         $DATA_DIR
  nginx        $SITE_FILE
  Backup       $BACKUP
  Logs         journalctl -u $SVC_NAME -f

Before taking real payments, check the receiving wallet has USDC and AUDD token accounts:
  cd $APP_DIR && sudo -u $SVC_USER node scripts/check-address.js \$(grep ^PAY_TO= $ENV_FILE | cut -d= -f2)
EOF
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  printf '\n\033[1;35m%s warning(s), none of which stopped the deployment:\033[0m\n' "${#WARNINGS[@]}"
  for w in "${WARNINGS[@]}"; do printf '  - %s\n' "$w"; done
fi
exit 0
