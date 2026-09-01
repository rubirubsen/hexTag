# Multi-Stage Node.js Fullstack Server (Express API + MSSQL + Vite Static Frontend)
FROM node:20-alpine AS builder

WORKDIR /app

# Dependencies cachen
COPY package.json package-lock.json ./
RUN npm ci

# Source-Code kopieren und Frontend bauen
COPY . .
RUN npm run build

# Stage 2: Production Node.js Server
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production

# Server-Code und gebautes Frontend kopieren
COPY server/ ./server/
COPY --from=builder /app/dist ./dist

EXPOSE 8480
ENV PORT=8480
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
