// 서버 API 호출 도우미
export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

async function request(method, url, body) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch('/api' + url, opt);
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth')) window.dispatchEvent(new Event('auth-expired'));
    throw new ApiError(res.status, data?.error || `요청 실패 (${res.status})`, data);
  }
  return data;
}

export const api = {
  get: u => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  patch: (u, b) => request('PATCH', u, b),
  put: (u, b) => request('PUT', u, b ?? {}),
  del: u => request('DELETE', u)
};
