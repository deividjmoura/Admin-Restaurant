#!/usr/bin/env bash
# provision-vps.sh — VPS centralizado (Ubuntu 22.04) para Admin-Restaurant
# Uso: ./scripts/provision-vps.sh <domínio> (ex.: seudominio.com)
# Requisitos: VPS limpa, usuário com sudo, DNS A/*.A apontando para o IP do VPS.
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Uso: $0 <BASE_DOMAIN>  (ex.: seudominio.com)"
  exit 1
fi

APP_DIR="/opt/admin-restaurant"
REPO_URL="https://github.com/deividjmoura/Admin-Restaurant.git"
BRANCH="main"
NODE_MAJOR=20

echo "==> Provisionando $DOMAIN em $APP_DIR (Node $NODE_MAJOR, PM2, Nginx, TLS)..."

# 1) Sistema
sudo apt-get update
sudo apt-get install -y curl git nginx certbot python3-certbot-nginx ufw

# 2) Node 20 (NodeSource)
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "v${NODE_MAJOR}"; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v; npm -v

# 3) PM2
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm i -g pm2
fi
pm2 -v || true

# 4) App (clone/pull)
if [[ -d "$APP_DIR/.git" ]]; then
  echo "==> Atualizando repo em $APP_DIR..."
  sudo git -C "$APP_DIR" fetch origin
  sudo git -C "$APP_DIR" checkout "$BRANCH"
  sudo git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  echo "==> Clonando $REPO_URL ($BRANCH) em $APP_DIR..."
  sudo git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
sudo chown -R "$USER":"$USER" "$APP_DIR" || true

cd "$APP_DIR"

# 5) Env — crie .env se não existir (copie de .env.example)
if [[ ! -f .env ]]; then
  echo "==> Criando .env a partir de .env.example — EDITE antes de iniciar!"
  cp .env.example .env
  # Gere secrets se estiverem placeholder
  JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  COOKIE=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  # Substitui placeholders
  sed -i "s|troque-por-um-segredo-longo-e-aleatorio|$JWT|g" .env || true
  sed -i "s|troque-por-outro-segredo-diferente|$COOKIE|g" .env || true
  sed -i "s|BASE_DOMAIN=localhost|BASE_DOMAIN=$DOMAIN|g" .env || true
  sed -i "s|APP_URL=http://localhost:3000|APP_URL=https://$DOMAIN|g" .env || true
  echo "==> .env criado. Revise: DATABASE_URL, JWT_SECRET, COOKIE_SECRET, BASE_DOMAIN, APP_URL, CORS_ORIGIN."
  echo "    Exemplo: DATABASE_URL=postgres://user:pass@host/db?sslmode=require  e  DATABASE_SSL=true"
  echo "    Pressione ENTER após revisar .env para continuar, ou Ctrl+C para abortar e editar manualmente."
  read -r
fi

# 6) Dependências e build (API serve o front)
npm ci
# Build do front gera frontend/dist servido por src/app.js (@fastify/static)
if [[ -f frontend/package.json ]]; then
  npm --prefix frontend ci || npm --prefix frontend install
  npm --prefix frontend run build
else
  echo "[aviso] frontend/package.json não encontrado — pulando build do front"
fi

# 7) Migrations
if grep -q "db:migrate" package.json; then
  echo "==> Rodando migrations..."
  npm run db:migrate || echo "[aviso] db:migrate falhou — verifique DATABASE_URL"
fi

# 8) PM2 — inicia/restart
echo "==> Configurando PM2..."
# ecosystem via CLI (evita arquivo extra)
pm2 delete admin-restaurant 2>/dev/null || true
PORT="${PORT:-3000}" pm2 start src/server.js --name admin-restaurant --update-env
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" || true
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME" || true

# 9) Nginx — proxy para Node (mesma origem, sem CORS)
echo "==> Configurando Nginx para $DOMAIN e *.$DOMAIN..."
sudo tee "/etc/nginx/sites-available/$DOMAIN" >/dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN *.$DOMAIN;

    # ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:${PORT:-3000};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # SSE
        proxy_set_header X-Tenant-Slug \$http_x_tenant_slug;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
NGINX
sudo ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
sudo nginx -t
sudo systemctl reload nginx

# 10) Firewall
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw --force enable || true

# 11) TLS (Let's Encrypt) — requer DNS já propagado
echo "==> Solicitando TLS via Certbot para $DOMAIN e *.$DOMAIN..."
echo "    Se o wildcard falhar (DNS challenge), será emitido apenas para $DOMAIN."
sudo certbot --nginx -d "$DOMAIN" -d "*.$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" || \
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" || \
  echo "[aviso] Certbot falhou — verifique DNS e rode manualmente: sudo certbot --nginx -d $DOMAIN"

# 12) Teste
echo "==> Testando..."
curl -s "http://127.0.0.1:${PORT:-3000}/ready" | head -c 500; echo
curl -s "https://$DOMAIN/ready" | head -c 500; echo || echo "[aviso] /ready externo falhou — verifique Nginx/DNS/TLS"

echo "==> Pronto. Logs: pm2 logs admin-restaurant | Nginx: sudo nginx -t && sudo systemctl status nginx"
echo "    Deploy segue docs/DEPLOY.md (API serve frontend/dist, caminhos relativos /api/... e ?tenant= para SSE)."
echo "    Backup: veja docs/BACKUP.md (Neon PITR + pg_dump)."
