import type { Data } from './model';
export const emptyData: Data = {
  version: 1,
  users: [],
  properties: [],
  reservations: [],
  currentUser: null,
  calendar: [],
  favorites: [],
  reviews: [],
  threads: [],
  messages: [],
  notifications: [],
  audit: [],
};
export async function request<T = { ok: boolean; id?: string }>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(method !== 'GET' ? { 'X-Little-Stay': '1' } : {}),
      ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const value = await response
    .json()
    .catch(() => ({ error: 'The local server did not return a valid response.' }));
  if (!response.ok) throw new Error(value.error ?? 'The request failed.');
  return value as T;
}
export const getState = () => request<Data>('/state');
export async function change(path: string, body?: unknown, method = 'POST') {
  await request(path, method, body);
  return getState();
}
