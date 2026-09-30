#!/usr/bin/env bash
# Обновляет yt-dlp и перезапускает сервис. Удобно повесить на cron раз в неделю:
#   0 5 * * 1 /srv/kombain/deploy/update-ytdlp.sh >> /var/log/yt-kombain-update.log 2>&1
set -euo pipefail
cd /srv/kombain
before=$(.venv/bin/python -c "import yt_dlp; print(yt_dlp.version.__version__)")
.venv/bin/pip install --quiet --upgrade "yt-dlp[default]"
after=$(.venv/bin/python -c "import yt_dlp; print(yt_dlp.version.__version__)")
if [ "$before" != "$after" ]; then
  echo "$(date -Is) yt-dlp: $before -> $after, перезапуск"
  sudo systemctl restart yt-kombain
else
  echo "$(date -Is) yt-dlp $after актуален"
fi
