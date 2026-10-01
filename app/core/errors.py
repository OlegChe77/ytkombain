"""Ошибки приложения и перевод сообщений yt-dlp/YouTube в понятный пользователю текст."""
from __future__ import annotations

import logging
import re

log = logging.getLogger("kombain.errors")


class AppError(Exception):
    """Ошибка, которую можно безопасно показать пользователю."""

    def __init__(self, message: str, *, status: int = 400, code: str = "bad_request", hint: str | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.hint = hint

    def to_dict(self) -> dict:
        data = {"code": self.code, "message": self.message}
        if self.hint:
            data["hint"] = self.hint
        return data


class JobCancelled(Exception):
    """Задачу отменил пользователь."""


class JobTimeout(Exception):
    """Задача не уложилась в отведённое время."""


# (шаблон в тексте ошибки yt-dlp, http-статус, код, сообщение, подсказка)
_RULES: list[tuple[re.Pattern, int, str, str, str | None]] = [
    (re.compile(r"private video", re.I), 403, "private",
     "Это приватное видео: доступ к нему есть только у владельца.", None),
    (re.compile(r"confirm your age|age[- ]restricted|inappropriate for some users", re.I), 403, "age_restricted",
     "У видео возрастное ограничение: YouTube требует вход в аккаунт.",
     "Такие видео Комбайн обработать не может."),
    (re.compile(r"not a bot|captcha|sign in to confirm", re.I), 503, "blocked",
     "Инструмент временно не работает: YouTube ограничил доступ с нашего сервера.",
     "Мы уже подключаем решение — скоро заработает."),
    (re.compile(r"members[- ]only|join this channel", re.I), 403, "members_only",
     "Видео доступно только спонсорам канала.", None),
    (re.compile(r"live event will begin|premieres in|this live stream|is upcoming", re.I), 409, "upcoming",
     "Трансляция или премьера ещё не началась.", "Вернитесь, когда видео появится в записи."),
    (re.compile(r"requested format is not available|format not available", re.I), 409, "format_gone",
     "Выбранный формат больше недоступен.", "Обновите список форматов и выберите другой."),
    (re.compile(r"playlist does not exist|does not have a .* tab|this channel does not exist|unable to recognize tab", re.I), 404, "not_found",
     "Плейлист или канал не найден — возможно, он скрыт или удалён.", None),
    (re.compile(r"not available in your country|blocked it in your country|geo", re.I), 451, "geo",
     "Видео недоступно в регионе, где работает сервер.", None),
    (re.compile(r"copyright|removed by the uploader|account .* terminated|has been removed", re.I), 410, "removed",
     "Видео удалено или заблокировано.", None),
    (re.compile(r"video unavailable|this video is unavailable|video is not available|incomplete youtube id", re.I), 404, "unavailable",
     "Видео недоступно: оно удалено, скрыто или ограничено по региону.", None),
    (re.compile(r"http error 429|too many requests", re.I), 503, "rate_limited",
     "YouTube просит сделать паузу: слишком много запросов.", "Попробуйте ещё раз через минуту."),
    (re.compile(r"timed out|timeout|read operation timed out", re.I), 504, "timeout",
     "YouTube слишком долго не отвечает.", "Попробуйте ещё раз чуть позже."),
    (re.compile(r"file is larger than max-filesize|max-filesize", re.I), 413, "too_large",
     "Файл больше допустимого размера для скачивания через Комбайн.", "Выберите качество пониже."),
    (re.compile(r"drm", re.I), 403, "drm",
     "Видео защищено DRM — скачать его нельзя.", None),
]


def friendly_error(exc: BaseException) -> AppError:
    """Превращает исключение yt-dlp/сети в AppError с понятным текстом."""
    if isinstance(exc, AppError):
        return exc
    if isinstance(exc, JobCancelled):
        return AppError("Операция отменена.", status=499, code="cancelled")
    if isinstance(exc, JobTimeout):
        return AppError("Операция заняла слишком много времени и была остановлена.",
                        status=504, code="timeout", hint="Попробуйте меньший объём данных или повторите позже.")
    text = str(exc)
    for pattern, status, code, message, hint in _RULES:
        if pattern.search(text):
            if code == "blocked":  # исходный текст нужен, чтобы понять, какой клиент YouTube отказал
                log.warning("YouTube blocked: %s", text[:400])
            return AppError(message, status=status, code=code, hint=hint)
    return AppError("Не получилось обработать ссылку.", status=502, code="upstream",
                    hint="Проверьте ссылку и попробуйте ещё раз. Если ошибка повторяется, YouTube мог изменить формат страницы.")
