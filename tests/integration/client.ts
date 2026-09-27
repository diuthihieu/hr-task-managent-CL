// Minimal HTTP client that signs in through NextAuth's credentials flow and
// keeps the session cookie, so tests exercise the real route handlers,
// authorization and database - nothing is mocked.

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3100";

export class Client {
  private cookies = new Map<string, string>();

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private store(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const idx = pair.indexOf("=");
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (value === "" || /Max-Age=0/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async login(email: string, password: string): Promise<boolean> {
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: this.cookieHeader() } });
    this.store(csrfRes);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: this.cookieHeader() },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE }),
    });
    this.store(res);
    return [...this.cookies.keys()].some((k) => k.includes("session-token"));
  }

  async req<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: "manual",
      headers: { cookie: this.cookieHeader(), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.store(res);
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON body
    }
    return { status: res.status, body: parsed as T };
  }

  get<T = unknown>(path: string) {
    return this.req<T>("GET", path);
  }
  post<T = unknown>(path: string, body: unknown = {}) {
    return this.req<T>("POST", path, body);
  }
  patch<T = unknown>(path: string, body: unknown) {
    return this.req<T>("PATCH", path, body);
  }
  del<T = unknown>(path: string) {
    return this.req<T>("DELETE", path);
  }
}
