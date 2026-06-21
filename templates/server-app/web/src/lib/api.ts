/**
 * Cliente HTTP del front. Envía la cookie de sesión (credentials) y, ante un 401 (sesión caducada),
 * manda al login. Úsalo para todas las llamadas a /api/* del dominio.
 */
export async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${url}`, {
    ...opts,
    credentials: "include",
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  });
  if (res.status === 401) {
    // Sesión caducada: el guard del router redirige al login en la próxima navegación.
    if (!location.pathname.endsWith("/login")) location.assign("/login");
    throw new Error("Sesión caducada");
  }
  if (!res.ok) {
    throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Error ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
