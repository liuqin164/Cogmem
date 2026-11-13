/**
 * The named model routes a user can add, switch between, and keep a key in.
 *
 * The shell has exactly one provider shape — OpenAI-compatible chat completions — so a route is four
 * fields and nothing else: a name, a base URL, a key, a model name. The mg gateway stays the built-in
 * route and is never written to this file: it is synthesized from the resident's existing env config
 * (`ShellConfig.model`), so an install that picked mg keeps working byte-for-byte as before, and
 * adding a custom route never rewrites the default one.
 *
 * The file is 0600 and the only place a custom key lives. No accessor here returns a key: a summary
 * carries `name`/`baseUrl`/`model`, and anything that prints a URL or an error goes through
 * `redactSecrets`/`redactUrl` first.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ModelRoute {
  name: string;
  /** An OpenAI-compatible base URL; `/chat/completions` is appended by the provider. */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** The built-in route's fixed name; a stored route may not shadow it. */
export const BUILTIN_ROUTE_NAME = 'mg';

/** What the store accepts: user-defined routes only. The built-in one is passed in separately. */
export const ROUTES_SCHEMA = 1;

interface RoutesFile {
  schema: number;
  active?: string;
  routes: ModelRoute[];
}

/** A route's public summary: everything but the key. */
export interface RouteSummary {
  name: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  builtin: boolean;
}

export function summarizeRoute(route: ModelRoute, builtin = false): RouteSummary {
  return { name: route.name, baseUrl: route.baseUrl, model: route.model, hasKey: route.apiKey !== '', builtin };
}

function asRoute(value: unknown): ModelRoute | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
  const model = typeof record.model === 'string' ? record.model.trim() : '';
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey : '';
  if (name === '' || baseUrl === '' || model === '') return undefined;
  return { name, baseUrl, apiKey, model };
}

/** Replace every occurrence of a known secret with `***`; short values are left alone (not keys). */
export function redactSecrets(text: string | undefined, secrets: Array<string | undefined>): string {
  let out = text ?? '';
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('***');
  }
  return out;
}

/**
 * A URL safe to print: userinfo and any query value equal to a known secret are masked, then the
 * whole string gets the plain `redactSecrets` pass (a caller may have the key inside the path).
 */
export function redactUrl(url: string | undefined, secrets: Array<string | undefined> = []): string {
  if (!url) return '';
  let masked = url;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }
    for (const [key, value] of parsed.searchParams) {
      if (value !== '' && secrets.some((secret) => secret !== undefined && secret === value)) parsed.searchParams.set(key, '***');
    }
    masked = parsed.toString();
  } catch {
    // Not a URL: the plain redaction below is the whole guard.
  }
  return redactSecrets(masked, secrets);
}

export class RouteStore {
  private data: RoutesFile = { schema: ROUTES_SCHEMA, routes: [] };
  private loadError?: string;

  constructor(readonly path: string) {}

  /**
   * A missing file is an empty store, not a failure: mg still answers. A file that exists but cannot
   * be read or is not this schema is remembered as `error` rather than silently discarded (Pi's
   * models.json behaves the same way: keep serving, surface the parse error), and `save` moves the
   * unreadable bytes aside before overwriting them, so a hand-edited mistake cannot lose routes.
   */
  load(): this {
    this.loadError = undefined;
    let raw: RoutesFile;
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8')) as RoutesFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.loadError = `routes_unreadable: ${error instanceof Error ? error.message : String(error)}`;
      }
      this.data = { schema: ROUTES_SCHEMA, routes: [] };
      return this;
    }
    if (!raw || raw.schema !== ROUTES_SCHEMA || !Array.isArray(raw.routes)) {
      this.loadError = `routes_schema: ${this.path} 不是 schema ${ROUTES_SCHEMA} 的路线表`;
      this.data = { schema: ROUTES_SCHEMA, routes: [] };
      return this;
    }
    const routes = raw.routes.map(asRoute).filter((route): route is ModelRoute => route !== undefined && route.name !== BUILTIN_ROUTE_NAME);
    const dropped = raw.routes.length - routes.length;
    if (dropped > 0) this.loadError = `routes_invalid_entries: ${dropped} 条路线字段不全或重名内置，已忽略`;
    this.data = { schema: ROUTES_SCHEMA, active: typeof raw.active === 'string' ? raw.active : undefined, routes };
    return this;
  }

  /** The load problem, if any; the routes that did parse stay usable and mg is always available. */
  get error(): string | undefined {
    return this.loadError;
  }

  list(): ModelRoute[] {
    return this.data.routes.map((route) => ({ ...route }));
  }

  /** Stored routes carry keys; callers that only display should use `summaries`. */
  get active(): string | undefined {
    return this.data.active;
  }

  find(name: string): ModelRoute | undefined {
    const route = this.data.routes.find((entry) => entry.name === name);
    return route ? { ...route } : undefined;
  }

  /** Upsert by name. The mg name is reserved: the built-in route is not replaceable this way. */
  add(route: ModelRoute): ModelRoute {
    const clean = asRoute(route);
    if (!clean) throw new Error('route_invalid: name, baseUrl and model are required');
    if (clean.name === BUILTIN_ROUTE_NAME) throw new Error(`route_name_reserved: "${BUILTIN_ROUTE_NAME}" is the built-in route`);
    const index = this.data.routes.findIndex((entry) => entry.name === clean.name);
    if (index === -1) this.data.routes.push(clean);
    else this.data.routes[index] = clean;
    this.save();
    return clean;
  }

  remove(name: string): boolean {
    const before = this.data.routes.length;
    this.data.routes = this.data.routes.filter((entry) => entry.name !== name);
    const removed = this.data.routes.length !== before;
    if (this.data.active === name) this.data.active = undefined;
    if (removed) this.save();
    return removed;
  }

  /** `undefined` means "the built-in route": nothing about mg is user configuration, so it is not stored. */
  setActive(name: string | undefined): void {
    this.data.active = name;
    this.save();
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    if (this.loadError && existsSync(this.path)) {
      try {
        renameSync(this.path, `${this.path}.broken`);
        this.loadError = undefined;
      } catch {
        // Best effort: an un-renamable file is still overwritten below, and `error` keeps naming it.
      }
    }
    writeFileSync(this.path, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}

/**
 * The name an install's custom route gets: the user's text, or `custom` when it is empty or reserved.
 * A collision with an existing stored route is the caller's to see (`add` upserts), but the built-in
 * name can never be picked by accident.
 */
export function safeRouteName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === BUILTIN_ROUTE_NAME) return 'custom';
  return trimmed;
}
