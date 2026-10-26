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
let stateSequence = 0;
const stateOrder = new WeakMap<Data, number>();

export const getStateOrder = (data: Data) => stateOrder.get(data) ?? 0;

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
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('The server did not return a valid response.');
  }
  if (!response.ok) {
    const error = value && typeof value === 'object' && 'error' in value ? value.error : null;
    throw new Error(typeof error === 'string' ? error : 'The request failed.');
  }
  return value as T;
}
export async function getState() {
  const order = ++stateSequence;
  const data = await request<Data>('/state');
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.users) ||
    !Array.isArray(data.properties) ||
    !Array.isArray(data.reservations) ||
    !['calendar', 'favorites', 'reviews', 'threads', 'messages', 'notifications', 'audit'].every(
      (key) => data[key as keyof Data] === undefined || Array.isArray(data[key as keyof Data]),
    ) ||
    (data.currentUser != null &&
      (typeof data.currentUser.id !== 'string' ||
        typeof data.currentUser.name !== 'string' ||
        !['guest', 'host', 'admin'].includes(data.currentUser.role)))
  )
    throw new Error('The server returned invalid application data.');
  stateOrder.set(data, order);
  return data;
}
export async function change(path: string, body?: unknown, method = 'POST') {
  await request(path, method, body);
  return getState();
}
export async function uploadPhotos(files: File[]) {
  if (!files.length || files.length > 8) throw new Error('Choose one to eight photos.');
  if (files.some((file) => file.size > 4 * 1024 * 1024))
    throw new Error('Each photo must be 4 MB or smaller.');
  const images: string[] = [];
  // Keep each multipart request below Vercel's 4.5 MB function payload limit.
  for (const file of files) {
    const form = new FormData();
    form.append('photos', file);
    images.push(...(await request<{ images: string[] }>('/uploads', 'POST', form)).images);
  }
  return images;
}
