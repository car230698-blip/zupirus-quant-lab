# Stage 1: Build modern React + TypeScript + AI SDK 6 frontend bundle
FROM node:22-slim AS frontend-builder
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src src
COPY web web
COPY public public
RUN npm run build

# Stage 2: Production Python runtime
FROM python:3.12.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 DATA_DIR=/data
WORKDIR /app

# Install Astral uv for lightning-fast multi-threaded package installation
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

COPY requirements.lock .
RUN uv pip install --system --no-cache -r requirements.lock uvloop && \
    useradd -u 10001 -m lab && mkdir /data && chown lab:lab /data
COPY --from=frontend-builder --chown=lab:lab /build/dist dist
COPY --chown=lab:lab app app
COPY --chown=lab:lab cli cli
COPY --chown=lab:lab data data
COPY --chown=lab:lab scripts scripts
COPY --chown=lab:lab pyproject.toml .
COPY --chown=lab:lab zupirus-cli .
USER lab
EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--workers","1","--proxy-headers","--forwarded-allow-ips","127.0.0.1,172.16.0.0/12,10.0.0.0/8"]
