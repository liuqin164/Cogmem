/**
 * The model router: one `ModelProvider` service whose active route can be swapped while the resident
 * keeps running. The agent loop reads `provider.name`/`provider.model` before every request and calls
 * `complete` on this object, so a switch changes the next turn without a restart and without touching
 * the transcript — the session is the checkpoint's, not the provider's.
 *
 * The built-in mg route is always present and always first; stored custom routes are appended.
 */
import type { ModelCompletionInput, ModelProvider, ModelTurn } from '../state/agent-loop.ts';
import type { NativePlugin } from '../plugins/host.ts';
import { MgModelProvider, type MgProviderConfig } from '../plugins/mg-provider.ts';
import { BUILTIN_ROUTE_NAME, RouteStore, redactUrl, summarizeRoute, type ModelRoute, type RouteSummary } from './routes.ts';

export interface ModelRouterOptions {
  store: RouteStore;
  /** The env-derived mg route. Never written to the store; it is the built-in default. */
  builtin: ModelRoute;
  timeoutMs: number;
}

export class ModelRouter implements ModelProvider {
  private provider: ModelProvider;
  private activeName: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: ModelRouterOptions) {
    this.timeoutMs = options.timeoutMs;
    const stored = options.store.active;
    const route = stored ? options.store.find(stored) : undefined;
    const initial = route ?? options.builtin;
    this.activeName = initial.name;
    this.provider = this.build(initial);
  }

  get name(): string {
    return this.provider.name;
  }

  get model(): string {
    return this.provider.model;
  }

  /** The active route's name, not the provider's display name. */
  get active(): string {
    return this.activeName;
  }

  routes(): ModelRoute[] {
    return [this.options.builtin, ...this.options.store.list().filter((route) => route.name !== BUILTIN_ROUTE_NAME)];
  }

  summaries(): RouteSummary[] {
    return this.routes().map((route) => summarizeRoute(route, route.name === BUILTIN_ROUTE_NAME));
  }

  /** `name/model`, the shape the TUI's route list already used for the single-route case. */
  labels(): string[] {
    return this.routes().map((route) => `${route.name}/${route.model}`);
  }

  /**
   * Switch to a named route. A stored route is remembered as the active one (so a restart resumes it);
   * switching to the built-in route clears that pointer instead of writing it, because nothing about
   * mg is user configuration — no pointer and "mg" mean the same thing on load.
   */
  switchTo(name: string): ModelRoute {
    const route = this.routes().find((entry) => entry.name === name);
    if (!route) throw new Error(`route_unknown: "${name}" 不在路线表里（可用：${this.routes().map((entry) => entry.name).join('、')}）`);
    this.provider = this.build(route);
    this.activeName = route.name;
    this.options.store.setActive(route.name === BUILTIN_ROUTE_NAME ? undefined : route.name);
    return route;
  }

  /** A broken routes file is remembered by the store; the resident still runs on mg. */
  get storeError(): string | undefined {
    return this.options.store.error;
  }

  complete(input: ModelCompletionInput): Promise<ModelTurn> {
    return this.provider.complete(input);
  }

  private build(route: ModelRoute): ModelProvider {
    const config: MgProviderConfig = { baseUrl: route.baseUrl, apiKey: route.apiKey, model: route.model, timeoutMs: this.timeoutMs };
    return new MgModelProvider(config, route.name);
  }
}

/** What a route looks like when printed: never the key, never a URL that carries one. */
export function routeLine(route: ModelRoute, active: boolean): string {
  const marker = active ? '●' : '○';
  const where = redactUrl(route.baseUrl, [route.apiKey]);
  return `${marker} ${route.name} · ${route.model} · ${where}`;
}

/** The plugin face: the router becomes the `model` service the runtime was already built around. */
export function modelRouterPlugin(router: ModelRouter): NativePlugin {
  return {
    name: 'model-router',
    provide: ['model'],
    apply(ctx) {
      ctx.provide('model', router);
      for (const route of router.routes()) ctx.registerProvider(route.name, { baseUrl: route.baseUrl, model: route.model });
    },
  };
}
