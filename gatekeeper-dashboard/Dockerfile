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
RUN printf 'server {\n  listen 3000;\n  proxy_set_header Host $host;\n  proxy_set_header X-Real-IP $remote_addr;\n  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n  proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;\n  location / {\n    root /usr/share/nginx/html;\n    try_files $uri $uri/ /index.html;\n  }\n  location /admin {\n    proxy_pass http://proxy:8000;\n  }\n  location /auth {\n    proxy_pass http://proxy:8000;\n  }\n  location /metrics {\n    proxy_pass http://proxy:8000;\n  }\n  location /proxy {\n    proxy_pass http://proxy:8000;\n  }\n  location /.well-known {\n    proxy_pass http://proxy:8000;\n  }\n  location /login {\n    proxy_pass http://proxy:8000;\n  }\n  location /oauth {\n    proxy_pass http://proxy:8000;\n  }\n  location /api {\n    proxy_pass http://proxy:8000;\n  }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE ${PORT:-3000}

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD sh -c "wget -q --spider http://localhost:${PORT:-3000}/ || exit 1"

CMD sed -i -e 's/listen 3000;/listen '"${PORT:-3000}"';/g' /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'
