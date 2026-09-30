# YouTube Комбайн: Python + yt-dlp + ffmpeg + Deno (JS-движок, который нужен yt-dlp для YouTube)
FROM denoland/deno:bin AS deno

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_ENV=production \
    SITE_URL=https://ytkombain.onrender.com \
    TEMP_DIR=/tmp/yt-kombain \
    DENO_DIR=/tmp/yt-kombain/deno \
    XDG_CACHE_HOME=/tmp/yt-kombain/cache \
    TRUST_PROXY=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deno /deno /usr/local/bin/deno

WORKDIR /srv/kombain
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
RUN useradd --create-home --uid 10001 kombain && mkdir -p /tmp/yt-kombain && chown kombain /tmp/yt-kombain
USER kombain

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s   CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8000'), timeout=4)"

# Один процесс: фоновые задачи и лимиты хранятся в памяти. Параллельность — потоками внутри процесса.
# Порт берётся из PORT (его задаёт Render), по умолчанию 8000.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*' --no-access-log --no-server-header --timeout-graceful-shutdown 10"]
