FROM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY app ./app
COPY public ./public
RUN npm run build

FROM golang:1.23-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /kekaku ./cmd/server

FROM alpine:3.21
RUN addgroup -S kekaku && adduser -S kekaku -G kekaku
WORKDIR /app
COPY --from=api /kekaku ./kekaku
COPY --from=web /src/dist ./dist
RUN mkdir -p /app/data && chown -R kekaku:kekaku /app
USER kekaku
ENV PORT=8080 DATABASE_PATH=/app/data/kekaku.db LEGACY_DATA_FILE=/app/data/kekaku.json STATIC_DIR=/app/dist
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["/app/kekaku"]
