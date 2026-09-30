"""Небольшой потокобезопасный TTL/LRU-кэш в памяти процесса."""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any, Hashable


class TTLCache:
    def __init__(self, maxsize: int = 256, ttl: float = 600):
        self.maxsize = maxsize
        self.ttl = ttl
        self._data: OrderedDict[Hashable, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Hashable) -> Any | None:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires, value = item
            if expires < time.monotonic():
                self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            return value

    def set(self, key: Hashable, value: Any, ttl: float | None = None) -> None:
        with self._lock:
            self._data[key] = (time.monotonic() + (ttl or self.ttl), value)
            self._data.move_to_end(key)
            while len(self._data) > self.maxsize:
                self._data.popitem(last=False)

    def prune(self) -> None:
        now = time.monotonic()
        with self._lock:
            for key in [k for k, (exp, _) in self._data.items() if exp < now]:
                self._data.pop(key, None)
