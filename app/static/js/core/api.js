// Запросы к API и опрос фоновых задач.

export class ApiError extends Error {
  constructor(message, { code = 'error', hint = null, status = 0 } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new ApiError('Операция отменена.', { code: 'cancelled' }));
  }, { once: true });
});

export async function api(path, { method = 'GET', body, signal, timeout = 70000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: 'same-origin',
    });
  } catch {
    if (signal?.aborted) throw new ApiError('Операция отменена.', { code: 'cancelled' });
    if (controller.signal.aborted) {
      throw new ApiError('Сервер слишком долго не отвечает.', { code: 'timeout', hint: 'Проверьте соединение и попробуйте ещё раз.' });
    }
    throw new ApiError('Нет связи с сервером.', { code: 'network', hint: 'Проверьте интернет и попробуйте ещё раз.' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const err = data?.error || {};
    throw new ApiError(err.message || `Сервер ответил ошибкой ${response.status}.`, {
      code: err.code || 'http', hint: err.hint || null, status: response.status,
    });
  }
  return data;
}

export const post = (path, body, options = {}) => api(path, { ...options, method: 'POST', body });

// Запускает фоновую задачу и опрашивает её, пока не будет результата.
export async function runJob(path, body, { onUpdate, signal } = {}) {
  let job = await post(path, body, { signal });
  const cancel = () => api(`/api/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  let delay = 450;
  try {
    for (;;) {
      onUpdate?.(job);
      if (job.status === 'done') return job.result;
      if (job.status === 'error' || job.status === 'cancelled') {
        const err = job.error || {};
        throw new ApiError(err.message || 'Операция не выполнена.', { code: err.code || job.status, hint: err.hint });
      }
      await sleep(delay, signal);
      delay = Math.min(delay + 150, 1200);
      job = await api(`/api/jobs/${job.id}`, { signal });
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
