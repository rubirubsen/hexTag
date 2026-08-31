# Stage 1: Build Frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Dependencies cachen
COPY package.json package-lock.json ./
RUN npm ci

# Source-Code kopieren und bauen
COPY . .
RUN npm run build

# Stage 2: Production Nginx Server
FROM nginx:alpine

# Eigene Nginx-Konfiguration fuer SPA kopieren
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Gebautes Frontend aus Stage 1 kopieren
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
