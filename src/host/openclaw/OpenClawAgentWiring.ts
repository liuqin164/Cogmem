/**
 * OpenClaw runs several agents from one config, and its MCP server map is global:
 * `mcp.servers` has no per-agent form (openclaw/openclaw#72591). So the only way one
 * OpenClaw agent gets a Cogmem identity of its own is a server entry of its own —
 * `mcp.servers.cogmem-<agentId>` — plus a per-agent tool denial for every other
 * entry (#148, ADR-0006, ADR-0009).
 *
 * The manual version of that is fail-open: miss one denial and the agent can call the
 * neighbour's server and read its memory, and the user reads that as a Cogmem bug. So
 * the denial is written here, and `verifyOpenClawAgentIsolation` re-reads the *written*
 * config and names the exact missing pattern rather than passing quietly.
 *
 * Nothing in this module touches the filesystem: it patches the parsed config object the
 * installer already holds, so the entries and the plugin land in one write.
 */

export interface OpenClawAgentRef {
  id: string;
  /** The config object that carries this agent's tool policy. */
  node: Record<string, unknown>;
}

export interface OpenClawAgentEntry {
  agentId: string;
  /** `mcp.servers` key, and the name OpenClaw uses for this server's tools. */
  name: string;
  command: string;
  args: string[];
  created: boolean;
}

export interface OpenClawAgentWiring {
  agents: string[];
  entries: OpenClawAgentEntry[];
  /** Patterns this run added, so a re-run that adds nothing can say so. */
  denialsAdded: Array<{ agentId: string; name: string; pattern: string }>;
}

export interface OpenClawIsolationReport {
  ok: boolean;
  /** One line per hole, naming the agent, the entry and the pattern that is missing. */
  problems: string[];
  /**
   * Things this command will not rewrite but the operator has to know: a policy that hides
   * an agent from its *own* memory, or a shared entry that bypasses the whole arrangement.
   * Reported, never fatal — neither is this command's to change.
   */
  warnings: string[];
}

/** The name a Json-parsed OpenClaw agent id gets in `mcp.servers`. */
export function openClawCogmemServerName(agentId: string): string {
  return openClawSafeServerName(`cogmem-${agentId}`);
}

/**
 * OpenClaw's own server-name sanitizer (`sanitizeToolFragment` with its 30-char cap:
 * a non-`[A-Za-z0-9_-]` becomes `-`, a name that does not start with a letter gets a
 * prefix, and a long one is truncated). Mirrored rather than assumed, because the
 * denial patterns have to name whatever OpenClaw actually calls the server.
 */
function openClawSafeServerName(raw: string): string {
  const normalized = raw.trim().replace(/[^A-Za-z0-9_-]/g, '-') || 'mcp';
  const providerSafe = /^[A-Za-z]/.test(normalized) ? normalized : `mcp-${normalized}`;
  return providerSafe.slice(0, 30);
}

/**
 * The agents an OpenClaw config defines.
 *
 * Both key shapes are read because both exist in the wild: `agents.entries` is an object
 * keyed by agent id (what current OpenClaw writes) and `agents.list` is the older array
 * form. An entry that names no id is refused rather than skipped — silently leaving an
 * agent out of the isolation wiring is the failure this whole file exists to prevent.
 *
 * `strict: false` reads the same names without that refusal, for the callers that only
 * need to know how many agents there are (and for `--remove`, which must not fail on a
 * config this command never wired). Strictness belongs where a denial has to be written,
 * not in the count that decides whether there is anything to write.
 */
export function openClawAgentRefs(root: Record<string, unknown>, options: { strict?: boolean } = {}): OpenClawAgentRef[] {
  const strict = options.strict !== false;
  const agents = isRecord(root.agents) ? root.agents : undefined;
  if (!agents) return [];
  const refs: OpenClawAgentRef[] = [];

  const fromMap = (value: unknown): void => {
    if (!isRecord(value)) return;
    for (const [key, node] of Object.entries(value)) {
      if (!isRecord(node)) {
        if (!strict) {
          refs.push({ id: key, node: {} });
          continue;
        }
        throw new Error(
          `agents.entries.${key} is not an object, so it has nowhere to carry a tool policy and its Cogmem identity cannot be denied to the others.`,
        );
      }
      refs.push({ id: key, node });
    }
  };
  const fromList = (value: unknown): void => {
    if (value === undefined) return;
    if (isRecord(value)) {
      fromMap(value);
      return;
    }
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item === 'string') {
        if (!strict) {
          refs.push({ id: item, node: {} });
          continue;
        }
        throw new Error(
          `agents.list names the agent "${item}" as a bare string, so it has nowhere to carry a tool policy. `
          + 'Give it an object with an id and the Cogmem wiring can deny every other agent\'s server.',
        );
      }
      if (!isRecord(item)) continue;
      const id = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : '';
      if (!id) {
        if (!strict) continue;
        throw new Error(`An agents.list entry has no id or name, so its Cogmem identity cannot be named: ${JSON.stringify(item)}`);
      }
      refs.push({ id, node: item });
    }
  };

  // The two shapes are both read: a config that carries the same agent in both keeps one
  // identity, and the denial is written into whichever object carries that agent's tools.
  fromMap(agents.entries);
  fromList(agents.list);
  return refs;
}

/** The distinct agent ids in a config, in declaration order. */
export function openClawAgentIds(refs: OpenClawAgentRef[]): string[] {
  return [...new Set(refs.map((ref) => ref.id))];
}

/**
 * Give every agent its own Cogmem server entry and deny it every other agent's.
 *
 * Additive on purpose: an entry or a tool policy somebody else wrote is reported as a
 * conflict instead of being replaced, and a denial that is already there is left where it
 * is, so a second run writes nothing (the ticket's idempotency requirement). `force` is
 * the way past a conflict, and it is the flag that already means "overwrite what is here".
 */
export function wireOpenClawCogmemAgentEntries(input: {
  root: Record<string, unknown>;
  refs: OpenClawAgentRef[];
  serverFor: (agentId: string) => { command: string; args: string[] };
  force?: boolean;
}): OpenClawAgentWiring {
  const agents = openClawAgentIds(input.refs);
  const servers = ensureObject(ensureObject(input.root, 'mcp'), 'servers');
  const entries: OpenClawAgentEntry[] = [];
  const denialsAdded: OpenClawAgentWiring['denialsAdded'] = [];
  const claimed = new Map<string, string>();
  const nodesByAgent = new Map<string, Record<string, unknown>[]>();
  for (const ref of input.refs) {
    const nodes = nodesByAgent.get(ref.id) ?? [];
    nodes.push(ref.node);
    nodesByAgent.set(ref.id, nodes);
  }

  for (const agentId of agents) {
    const name = openClawCogmemServerName(agentId);
    const clash = claimed.get(name);
    if (clash) {
      throw new Error(
        `OpenClaw agents "${clash}" and "${agentId}" both ask Cogmem for the same server name "${name}", `
        + 'so two agents would share one identity. Rename one agent.',
      );
    }
    claimed.set(name, agentId);
  }

  for (const agentId of agents) {
    const name = openClawCogmemServerName(agentId);
    const { command, args } = input.serverFor(agentId);
    const existing = servers[name];
    const ours = isRecord(existing) && isEntryWeWroteFor(existing, agentId);
    if (isRecord(existing) && !ours && !input.force) {
      throw new Error(
        `mcp.servers.${name} already exists and was not written for agent "${agentId}" (args: ${JSON.stringify(existing.args ?? null)}). `
        + `It is either a hand-written entry or one for another identity; re-run with --force to replace it with the agent's own.`,
      );
    }
    // Everything the user put in the entry besides the command line — an env, a cwd — is
    // kept: only the two fields that decide which identity this server speaks are ours.
    servers[name] = { ...(ours ? (existing as Record<string, unknown>) : {}), command, args };
    entries.push({ agentId, name, command, args, created: !ours });

    for (const other of agents) {
      if (other === agentId) continue;
      const otherName = openClawCogmemServerName(other);
      for (const node of nodesByAgent.get(agentId) ?? []) {
        if (denialHiding(denyPatterns(node), otherName)) continue;
        const pattern = `${otherName}__*`;
        addDenial(node, pattern);
        denialsAdded.push({ agentId, name: otherName, pattern });
      }
    }
  }

  return { agents, entries, denialsAdded };
}

/**
 * Whether the written config actually keeps the agents apart.
 *
 * This is the fail-loud half of #148. The manual setup failed open — one missing denial
 * and two agents' memory silently mingled — so every pair is re-read from the config that
 * will be on disk, and every hole is named with the pattern that closes it. A server this
 * run did not create is checked too, because the leak does not care who wrote it.
 *
 * `requireOwnEntries` is the difference between the check before the wiring and the check
 * after it: before, an agent that has no entry yet is the normal state of the run that is
 * about to create one, and only a *visible neighbour* is a reason to stop. After, every
 * agent must have its own entry, because that is what this command just wrote.
 */
export function verifyOpenClawAgentIsolation(
  root: Record<string, unknown>,
  refs: OpenClawAgentRef[],
  options: { requireOwnEntries?: boolean } = {},
): OpenClawIsolationReport {
  const requireOwnEntries = options.requireOwnEntries !== false;
  const agents = openClawAgentIds(refs);
  const problems: string[] = [];
  const warnings: string[] = [];
  if (agents.length < 2) return { ok: true, problems, warnings };

  const servers = isRecord(isRecord(root.mcp) ? root.mcp.servers : undefined)
    ? (root.mcp as Record<string, unknown>).servers as Record<string, unknown>
    : undefined;

  for (const agentId of agents) {
    const own = openClawCogmemServerName(agentId);
    const nodes = refs.filter((ref) => ref.id === agentId).map((ref) => ref.node);
    if (requireOwnEntries && !isRecord(servers?.[own])) {
      problems.push(`agent "${agentId}" has no mcp.servers.${own} entry, so it has no Cogmem identity of its own`);
    }
    for (const node of nodes) {
      const patterns = denyPatterns(node);
      // A denial hides the agent from a neighbour; an allow list can hide it from itself,
      // and "the host is wired and has no memory" is the failure that reads as a Cogmem bug
      // (#108). Only the agent's own list is judged here: the layers above it (defaults, the
      // root policy) are OpenClaw's to merge, and guessing at them would be a warning that
      // is sometimes wrong.
      const allow = allowPatterns(node);
      if (allow.length > 0 && !allow.some((pattern) => pattern.startsWith(`${own}__`) || globMatches(pattern.toLowerCase(), `${own}__`))) {
        warnings.push(`agent "${agentId}" has a tools.allow list that does not name "${own}__*", so its own Cogmem tools are hidden from it`);
      }
      const selfDenial = isRecord(servers?.[own]) ? denialHiding(patterns, own) : undefined;
      if (selfDenial) {
        problems.push(`agent "${agentId}" denies its own entry mcp.servers.${own}: remove "${selfDenial}" from agents...${agentId}.tools.deny`);
      }
      for (const other of agents) {
        if (other === agentId) continue;
        const otherName = openClawCogmemServerName(other);
        if (!isRecord(servers?.[otherName])) continue;
        if (denialHiding(patterns, otherName)) continue;
        problems.push(
          `agent "${agentId}" can see mcp.servers.${otherName} (agent "${other}"'s entry): `
          + `agents...${agentId}.tools.deny is missing "${otherName}__*"`,
        );
      }
    }
  }

  // The manual path this ticket automates — `openclaw mcp add cogmem` — leaves one server
  // that every agent can call. It is not this command's to remove, but leaving it unreported
  // would hand back a config that looks isolated and is not.
  if (isRecord(servers?.cogmem)) {
    warnings.push('mcp.servers.cogmem is shared by every agent, so what one agent writes under it another can recall; the agents already have one entry each, so remove it or deny it per agent');
  }
  return { ok: problems.length === 0, problems, warnings };
}

/** The `tools.allow` list of one agent entry, or an empty list when it has none. */
function allowPatterns(node: Record<string, unknown>): string[] {
  const tools = isRecord(node.tools) ? node.tools : undefined;
  return stringList(tools?.allow);
}

/** The `tools.deny` list of one agent entry, or an empty list when it has none. */
function denyPatterns(node: Record<string, unknown>): string[] {
  const tools = isRecord(node.tools) ? node.tools : undefined;
  return stringList(tools?.deny);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Take the per-agent wiring back out, and only what this command writes.
 *
 * `connect <host> --remove` means "back to how it was", and an entry that survives the
 * removal is a server the host still starts for a plugin that is gone (#176). The same
 * guard as everywhere else applies: an entry whose command line is not the one written
 * here for that agent is somebody else's and stays.
 */
export function unwireOpenClawCogmemAgentEntries(root: Record<string, unknown>, refs: OpenClawAgentRef[]): void {
  const agents = openClawAgentIds(refs);
  if (agents.length === 0) return;

  const mcp = isRecord(root.mcp) ? root.mcp : undefined;
  const servers = isRecord(mcp?.servers) ? mcp.servers : undefined;
  const removed = new Set<string>();
  if (servers) {
    for (const agentId of agents) {
      const name = openClawCogmemServerName(agentId);
      if (!isRecord(servers[name]) || !isEntryWeWroteFor(servers[name] as Record<string, unknown>, agentId)) continue;
      delete servers[name];
      removed.add(name);
    }
    if (removed.size > 0 && Object.keys(servers).length === 0 && mcp) {
      delete mcp.servers;
      if (Object.keys(mcp).length === 0) delete root.mcp;
    }
  }

  for (const ref of refs) {
    const tools = isRecord(ref.node.tools) ? ref.node.tools : undefined;
    if (!tools || !Array.isArray(tools.deny)) continue;
    // Only the denials that named a server this removed: a `cogmem-<agent>` entry somebody
    // else wrote is still there, and it still has to stay hidden from the other agents.
    const kept = tools.deny.filter((entry: unknown) => {
      if (typeof entry !== 'string' || !entry.endsWith('__*')) return true;
      return !removed.has(entry.slice(0, -3));
    });
    if (kept.length === 0) delete tools.deny;
    else tools.deny = kept;
    // A `tools: {}` this command emptied is this command's to remove, like the empty
    // `mcp_servers` map the other unpatch paths drop: leaving it is a diff the user reads
    // as a change the removal did not explain (#116 review).
    if (Object.keys(tools).length === 0) delete ref.node.tools;
  }
}

function addDenial(node: Record<string, unknown>, pattern: string): void {
  const tools = ensureObject(node, 'tools');
  tools.deny = [...stringList(tools.deny), pattern];
}

/**
 * Whether a denial hides a whole server, judged the way OpenClaw judges it.
 *
 * `createMcpServerToolDenyMatcher` matches the denials that end in `*` against
 * `<safeServerName>__`, and every tool of a server is named `<safeServerName>__<tool>`,
 * so a namespace is hidden exactly when such a pattern matches. Both sides are lowered
 * because `normalizeToolPolicyName` lowercases everything before matching.
 */
function denialHiding(patterns: string[], server: string): string | undefined {
  const namespace = `${server}__`.toLowerCase();
  return patterns.find((pattern) => pattern.endsWith('*') && globMatches(pattern.toLowerCase(), namespace));
}

/** OpenClaw's glob: `*` is the only wildcard, everything else is literal. */
function globMatches(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

/** The flags the entry this command writes carries. */
const OUR_FLAGS = new Set(['--host', '--project', '--config']);

/**
 * True when this entry is the one this command writes for this agent.
 *
 * Two facts, both needed. It has to name this agent (`--host`), which is the identity —
 * `cogmem mcp` and the standalone `cogmem-mcp` entry point write different args, the
 * second without the positional `mcp`, so the shape of the line is not the test. And it
 * must carry no flag this command does not write: `--db`, `--profile`, `--agents`,
 * `--transport` are somebody's deliberate configuration, and rewriting that would retarget
 * an integration the operator built on purpose. Same judgment as the Hermes patcher's
 * `isSupersededCogmemMcpArgs`, and the same outcome: a conflict a human resolves, not a
 * silent replacement (#79).
 */
function isEntryWeWroteFor(entry: Record<string, unknown>, agentId: string): boolean {
  const args = Array.isArray(entry.args) ? entry.args.filter((value): value is string => typeof value === 'string') : [];
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith('--')) continue;
    flags.set(token, args[index + 1] ?? '');
    index += 1;
  }
  if (flags.get('--host') !== agentId) return false;
  return [...flags.keys()].every((flag) => OUR_FLAGS.has(flag));
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  if (!isRecord(parent[key])) parent[key] = {};
  return parent[key] as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
