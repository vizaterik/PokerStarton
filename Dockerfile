# Low-RAM VPS: frontend is prebuilt into deploy/frontend-dist (no Node/Vite here).
# Refresh static: cd frontend && set VITE_DOCKER_BUILD=1&& set VITE_API_BASE=&& npm run build:docker
# then copy dist → deploy/frontend-dist before commit/push.
FROM python:3.12-slim
WORKDIR /app
COPY deploy/frontend-dist /app/static
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
