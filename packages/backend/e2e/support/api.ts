import { openAsBlob } from "node:fs";
import path from "node:path";
import { inject } from "vitest";

export interface ApiResponse<T = any> {
  status: number;
  headers: Headers;
  body: T;
}

type Auth =
  | { kind: "none" }
  | { kind: "cookie"; cookie: string }
  | { kind: "bearer"; apiKey: string }
  | { kind: "x-api-key"; apiKey: string };

export interface RequestOptions {
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

export interface UploadFile {
  field: string;
  path: string;
  contentType: string;
  filename?: string;
}

let ipCounter = 0;

/**
 * Unique client IP per call. The backend trusts the first proxy hop, so this
 * keeps IP-keyed rate limits (login) from leaking between tests.
 */
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.${(process.pid >> 8) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export class ApiClient {
  // Each client gets its own IP so anonymous IP-keyed rate limits never collide across tests
  private readonly ip = uniqueIp();

  constructor(
    readonly apiUrl: string,
    private readonly auth: Auth = { kind: "none" }
  ) {}

  static anonymous(): ApiClient {
    return new ApiClient(inject("e2e").apiUrl);
  }

  withBearer(apiKey: string): ApiClient {
    return new ApiClient(this.apiUrl, { kind: "bearer", apiKey });
  }

  withXApiKey(apiKey: string): ApiClient {
    return new ApiClient(this.apiUrl, { kind: "x-api-key", apiKey });
  }

  withCookie(cookie: string): ApiClient {
    return new ApiClient(this.apiUrl, { kind: "cookie", cookie });
  }

  async request<T = any>(method: string, urlPath: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { "X-Forwarded-For": this.ip, ...options.headers };
    if (this.auth.kind === "cookie") headers.Cookie = this.auth.cookie;
    if (this.auth.kind === "bearer") headers.Authorization = `Bearer ${this.auth.apiKey}`;
    if (this.auth.kind === "x-api-key") headers["X-API-Key"] = this.auth.apiKey;

    let body: string | FormData | undefined;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    }

    const response = await fetch(`${this.apiUrl}${urlPath}`, { method, headers, body });
    const contentType = response.headers.get("content-type") ?? "";
    const parsed = contentType.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());

    return { status: response.status, headers: response.headers, body: parsed as T };
  }

  get<T = any>(urlPath: string, options?: RequestOptions) {
    return this.request<T>("GET", urlPath, options);
  }

  post<T = any>(urlPath: string, json?: unknown, options?: RequestOptions) {
    return this.request<T>("POST", urlPath, { ...options, json });
  }

  patch<T = any>(urlPath: string, json?: unknown, options?: RequestOptions) {
    return this.request<T>("PATCH", urlPath, { ...options, json });
  }

  put<T = any>(urlPath: string, json?: unknown, options?: RequestOptions) {
    return this.request<T>("PUT", urlPath, { ...options, json });
  }

  delete<T = any>(urlPath: string, options?: RequestOptions) {
    return this.request<T>("DELETE", urlPath, options);
  }

  async upload<T = any>(
    urlPath: string,
    files: UploadFile[],
    fields: Record<string, string | string[]> = {},
    options: RequestOptions = {}
  ) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) form.append(name, item);
    }
    for (const file of files) {
      const blob = await openAsBlob(file.path, { type: file.contentType });
      form.append(file.field, blob, file.filename ?? path.basename(file.path));
    }
    return this.request<T>("POST", urlPath, { ...options, form });
  }
}

export async function login(email: string, password: string): Promise<ApiClient> {
  const anonymous = ApiClient.anonymous();
  const response = await anonymous.post("/auth/login", { email, password }, {
    headers: { "X-Forwarded-For": uniqueIp() },
  });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .find((pair) => pair?.startsWith("connect.sid="));
  if (!cookie) throw new Error("Login response did not set a session cookie");
  return anonymous.withCookie(cookie);
}
