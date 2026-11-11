# ---- Build: Frontend ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci
COPY web web
# Beispiel-Vault wird als Demo in die Oberfläche eingebettet
COPY examples examples
RUN npm run build -w web

# ---- Laufzeit ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 VAULT_PATH=/vault STATIC_DIR=/app/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/info >/dev/null || exit 1
CMD ["node", "server/src/index.js"]
