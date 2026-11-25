FROM node:22-alpine

# Build-Abhängigkeiten für better-sqlite3 & native Addons
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Frontend-Build erzeugen
RUN npm run build

# Persistentes Datenverzeichnis für SQLite-Backups und Dateianhänge
RUN mkdir -p /app/data/backups /app/data/uploads

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/auth/status || exit 1

CMD ["node", "server.ts"]
