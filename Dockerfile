# ── Stage 1: Build worker ────────────────────────────────────────────────────
FROM node:22-alpine AS worker-build
WORKDIR /app/worker
COPY worker/package*.json ./
RUN npm install
COPY worker/ .
RUN npx tsc --noEmit

# ── Stage 2: Build frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# VITE_WORKER_URL="" → same-origin mode: nginx proxies /room/* to wrangler
# Override at build time: docker build --build-arg VITE_WORKER_URL=wss://...
ARG VITE_WORKER_URL=""
ENV VITE_WORKER_URL=${VITE_WORKER_URL}
RUN npm run build

# ── Stage 3: Production ───────────────────────────────────────────────────────
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends nginx netcat-openbsd && rm -rf /var/lib/apt/lists/*

# Worker
WORKDIR /app/worker
COPY --from=worker-build /app/worker/node_modules ./node_modules
COPY worker/ .

# Frontend static files
COPY --from=frontend-build /app/dist /usr/share/nginx/html

# Nginx: serve SPA + proxy /room/* WebSocket to wrangler on :8787
RUN cat > /etc/nginx/conf.d/gomoku.conf <<'EOF'
server {
    listen 80;

    location /room/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600;
    }

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
EOF
# Remove debian's default site so it doesn't conflict
RUN rm -f /etc/nginx/sites-enabled/default

# Entrypoint: start wrangler (local mode) then nginx
RUN cat > /start.sh <<'EOF'
#!/bin/sh
set -e
cd /app/worker
CI=true npx wrangler dev --port 8787 --host 127.0.0.1 &
# Wait until wrangler is accepting connections before starting nginx
echo "Waiting for wrangler on :8787..."
for i in $(seq 1 30); do
  if nc -z 127.0.0.1 8787 2>/dev/null; then
    echo "Wrangler ready."
    break
  fi
  sleep 1
done
nginx -g "daemon off;"
EOF
RUN chmod +x /start.sh

EXPOSE 80
CMD ["/start.sh"]
