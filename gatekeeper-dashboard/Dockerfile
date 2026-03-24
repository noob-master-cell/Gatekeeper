FROM node:20-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ─── Production stage ─────────────────────────────
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Write an nginx config TEMPLATE (uses $PROXY_URL and $LISTEN_PORT placeholders)
RUN mkdir -p /etc/nginx/templates && printf 'server {\n\
  listen ${LISTEN_PORT};\n\
  proxy_set_header Host $host;\n\
  proxy_set_header X-Real-IP $remote_addr;\n\
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
  proxy_set_header X-Forwarded-Proto $scheme;\n\
  location / {\n\
    root /usr/share/nginx/html;\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
  location /admin  { proxy_pass ${PROXY_URL}; }\n\
  location /auth   { proxy_pass ${PROXY_URL}; }\n\
  location /metrics { proxy_pass ${PROXY_URL}; }\n\
  location /proxy  { proxy_pass ${PROXY_URL}; }\n\
  location /.well-known { proxy_pass ${PROXY_URL}; }\n\
  location /login  { proxy_pass ${PROXY_URL}; }\n\
  location /oauth  { proxy_pass ${PROXY_URL}; }\n\
  location /api    { proxy_pass ${PROXY_URL}; }\n\
}\n' > /etc/nginx/templates/default.conf.template

# Defaults: Docker Compose uses proxy:8000, Railway overrides via env vars
ENV PROXY_URL=http://proxy:8000
ENV LISTEN_PORT=3000

EXPOSE ${PORT:-3000}

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD sh -c "wget -q --spider http://localhost:${LISTEN_PORT}/ || exit 1"

# envsubst runs automatically via nginx:alpine's docker-entrypoint on *.template files
# We also override LISTEN_PORT from PORT if set (Railway sets PORT)
CMD sh -c "export LISTEN_PORT=\${PORT:-3000} && /docker-entrypoint.sh nginx -g 'daemon off;'"
