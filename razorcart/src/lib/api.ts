export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    { message?: string; code?: string } | T | null;
  if (!response.ok) {
    const errorBody = body as { message?: string; code?: string } | null;
    throw new ApiError(
      errorBody?.message || 'RazorCart could not complete that request.',
      response.status,
      errorBody?.code,
    );
  }
  return body as T;
}
