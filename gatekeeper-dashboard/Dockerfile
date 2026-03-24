FROM node:20-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ─── Production stage ─────────────────────────────
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# SPA fallback
RUN printf 'server {\n  listen 3000;\n  location / {\n    root /usr/share/nginx/html;\n    try_files $uri $uri/ /index.html;\n  }\n  location /admin {\n    proxy_pass http://proxy:8000;\n  }\n  location /auth {\n    proxy_pass http://proxy:8000;\n  }\n  location /metrics {\n    proxy_pass http://proxy:8000;\n  }\n  location /proxy {\n    proxy_pass http://proxy:8000;\n  }\n  location /.well-known {\n    proxy_pass http://proxy:8000;\n  }\n  location /login {\n    proxy_pass http://proxy:8000;\n  }\n  location /oauth {\n    proxy_pass http://proxy:8000;\n  }\n  location /api {\n    proxy_pass http://proxy:8000;\n  }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD wget -q --spider http://localhost:3000/ || exit 1
