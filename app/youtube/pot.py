"""Сервер PO-токенов bgutil для yt-dlp (POT_SERVER_DIR).

С IP дата-центров YouTube часто отвечает «Sign in to confirm you're not a bot». Плагин
bgutil-ytdlp-pot-provider получает у этого сервера токены «подлинного клиента», как это делает
браузер, без входа в аккаунт. Сервер слушает только localhost; приложение запускает его при старте
и перезапускает, если он упал.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress

import httpx

from app.config import settings

log = logging.getLogger("kombain.pot")

PORT = 4416  # порт по умолчанию, на который смотрит плагин bgutil
_task: asyncio.Task | None = None
_proc: asyncio.subprocess.Process | None = None


def command() -> list[str] | None:
    home = settings.pot_server_dir
    deno = (settings.js_runtimes.get("deno") or {}).get("path") or "deno"
    if not home or not (home / "src" / "main.ts").is_file():
        return None
    modules = home / "node_modules"
    return [
        deno, "run",
        f"--v8-flags=--max-old-space-size={settings.pot_max_heap_mb}",
        "--allow-env", "--allow-net", f"--allow-ffi={modules}", f"--allow-read={modules}",
        str(home / "src" / "main.ts"), "--port", str(PORT),
    ]


async def _supervise(cmd: list[str]) -> None:
    global _proc
    loop = asyncio.get_running_loop()
    env = {**os.environ, "DENO_DIR": str(settings.pot_server_dir / ".cache" / "deno"),
           "DENO_NO_PROMPT": "1", "DENO_NO_UPDATE_CHECK": "1"}
    delay = 5
    while True:
        started = loop.time()
        try:
            # stdout сервера печатает каждый токен — в журнал Render пускаем только ошибки (stderr).
            _proc = await asyncio.create_subprocess_exec(*cmd, cwd=settings.pot_server_dir, env=env,
                                                         stdout=asyncio.subprocess.DEVNULL)
            log.info("сервер PO-токенов запущен (pid %s)", _proc.pid)
            code = await _proc.wait()
            log.warning("сервер PO-токенов завершился с кодом %s", code)
        except OSError as exc:
            log.warning("сервер PO-токенов не запустился: %s", exc)
        if loop.time() - started > 300:
            delay = 5
        await asyncio.sleep(delay)
        delay = min(delay * 2, 300)


def start() -> None:
    global _task
    cmd = command()
    if cmd and _task is None:
        _task = asyncio.create_task(_supervise(cmd))


async def stop() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    with suppress(asyncio.CancelledError):
        await _task
    _task = None
    if _proc and _proc.returncode is None:
        _proc.terminate()
        with suppress(asyncio.TimeoutError, ProcessLookupError):
            await asyncio.wait_for(_proc.wait(), 5)


async def status() -> str | None:
    """None — сервер не настроен; иначе версия сервера или «down»."""
    if _task is None:
        return None
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            response = await client.get(f"http://127.0.0.1:{PORT}/ping")
        return str(response.json().get("version") or "up")
    except Exception:  # noqa: BLE001
        return "down"
