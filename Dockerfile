# Stage 1: Build modern React + TypeScript + AI SDK 6 frontend bundle
FROM node:22-slim AS frontend-builder
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src src
COPY web web
RUN npm run build

# Stage 2: Production Python runtime
FROM python:3.12.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 DATA_DIR=/data
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock && useradd -u 10001 -m lab && mkdir /data && chown lab:lab /data
COPY --from=frontend-builder --chown=lab:lab /build/dist dist
COPY --chown=lab:lab app app
COPY --chown=lab:lab cli cli
COPY --chown=lab:lab web web
COPY --chown=lab:lab data data
COPY --chown=lab:lab tests tests
COPY --chown=lab:lab ea ea
COPY --chown=lab:lab scripts scripts
COPY --chown=lab:lab pyproject.toml .
COPY --chown=lab:lab zupirus-cli .
USER lab
EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--workers","1","--no-proxy-headers"]
