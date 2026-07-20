# Same-origin deploy: UI + API on one host (avoids browser CORS to a second Render service).
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Empty base → browser calls /api and /health on the same origin.
ENV VITE_API_BASE=
# Low-RAM VPS: one Rollup worker, no minify/sourcemaps (avoids hang after transform).
ENV VITE_DOCKER_BUILD=1
ENV NODE_OPTIONS=--max-old-space-size=512
RUN npm run build:docker

# Frontend first so BuildKit does not run apt + npm build at the same time (low-RAM VPS).
FROM python:3.12-slim
WORKDIR /app
COPY --from=frontend /fe/dist /app/static
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
ENV DESKTOP_STATIC_DIR=/app/static
ENV PYTHONUNBUFFERED=1
EXPOSE 10000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
