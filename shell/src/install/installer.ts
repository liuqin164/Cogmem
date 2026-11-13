/**
 * The six-step install of a self-owned companion (F21, #203). No memory inheritance, no migration
 * branch: every version so far has no users, so there is one path and it is a fresh one.
 *
 * The install itself is a state machine by the same discipline the resident uses: forward-only
 * steps, each idempotent, each one's completion written to `<dataDir>/install.json` only after it
 * fully succeeded. Re-running the installer resumes at the first step that is not done, which is
 * what makes a failure at the model probe a place you come back to rather than a restart.
 *
 * `ponytail:` no install lock. A second installer on the same data dir races the state file; a
 * single-shot command does not need one, add it when concurrent installs ever become a thing.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createMemoryKernel } from 'cogmem';
import { DEFAULT_SOUL, readSoul, writeDefaultSoul } from './soul.ts';
import { MG_DEFAULT_BASE_URL, MG_DEFAULT_MODEL, MODEL_PRESETS, modelEnv, probeModel, type ModelChoice, type ModelProviderKind } from './model.ts';
import { RouteStore, safeRouteName, type ModelRoute } from '../model/routes.ts';
import {
  installService,
  residentArgs,
  restartService,
  uninstallService,
  type CommandResult,
  type Platform,
  type Runner,
  type ServiceSpec,
} from './service.ts';
import { runDoctor, type DoctorReport, type HealthPayload } from './doctor.ts';
import { openProbeSession, type ProbeSession } from './attach.ts';
import { createTerminalIO, type InstallIO, type TerminalStreams } from './io.ts';

export const INSTALL_STEPS = ['preflight', 'place', 'model', 'rhythm', 'resident', 'awake'] as const;
export type InstallStepId = (typeof INSTALL_STEPS)[number];

const STEP_LABELS: Record<InstallStepId, string> = {
  preflight: '预检（系统 / 运行时 / 磁盘 / 端口）',
  place: '落位（装包、建数据目录、空库初始化、写默认 soul）',
  model: '模型（选 provider、填钥匙、当场探活）',
  rhythm: '节律（时区、做梦时点、勿扰窗）',
  resident: '常驻（注册用户级服务、拉起、doctor、星海地址）',
  awake: '自检式首醒（落账 → 重启 → 召回对上）',
};

export interface InstallFlags {
  dataDir?: string;
  workspace?: string;
  project?: string;
  agent?: string;
  httpPort?: number;
  /** `linux` | `darwin` | `win32`; the last is refused with a plain reason. */
  platform?: string;
  serviceName?: string;
  homeDir?: string;
  /** Where the shell package lives, when the entry point is not beside it. */
  shell?: string;
  yes?: boolean;
  skipService?: boolean;
  uninstall?: boolean;
  help?: boolean;
}

export interface InstallChoices {
  dataDir: string;
  workspaceRoot: string;
  projectId: string;
  agentId: string;
  httpPort: number;
  platform: string;
  serviceName: string;
  timeZone: string;
  dreamStartHour: number;
  dreamEndHour: number;
  quietStartHour: number | null;
  quietEndHour: number | null;
  /** No api key here, ever: the key lives only in the 0600 env file. */
  model: { provider: ModelProviderKind; baseUrl: string; model: string };
}

export interface InstallState {
  schema: 1;
  done: InstallStepId[];
  failedAt?: InstallStepId;
  choices: Partial<InstallChoices>;
  /** The detached resident, when the install runs in `--skip-service` mode. */
  pid?: number;
  updatedAt: number;
}

export interface ResidentHandle {
  pid: number;
  kill(): void;
}

export interface InstallerHooks {
  probe?: typeof probeModel;
  fetchHealth?: (url: string) => Promise<HealthPayload>;
  /** The first-wake probe's channel to the running resident: its attach control socket. */
  openProbe?: (socketPath: string) => Promise<ProbeSession>;
  /** `--skip-service` only: how to start and stop the resident without a service manager. */
  spawnResident?: (args: string[], env: Record<string, string>, cwd: string) => ResidentHandle;
}

export interface InstallerOptions {
  io: InstallIO;
  run: Runner;
  flags: InstallFlags;
  shellDir: string;
  bunPath: string;
  cwd: string;
  /** `process.platform`, unnormalized, so `win32` reaches preflight and is refused there. */
  platform: string;
  homeDir: string;
  now?: () => number;
  hooks?: InstallerHooks;
}

type StepResult = { ok: true } | { ok: false; message: string; hint?: string };

/** The real runner: spawn, collect, never echo a key (callers only pass commands, not secrets). */
export function defaultRunner(): Runner {
  return (command, args, options = {}) =>
    new Promise<CommandResult>((resolvePromise) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      const timer = options.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), options.timeoutMs) : undefined;
      child.on('error', (error) => {
        if (timer) clearTimeout(timer);
        resolvePromise({ code: 127, stdout, stderr: `${stderr}${error.message}` });
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolvePromise({ code: code ?? 1, stdout, stderr });
      });
    });
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line);
    if (match) result[match[1]!] = match[2]!;
  }
  return result;
}

function serializeEnvFile(values: Record<string, string>): string {
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

function hour(value: string | number, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : fallback;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export class Installer {
  private readonly io: InstallIO;
  private readonly runner: Runner;
  private readonly flags: InstallFlags;
  private readonly shellDir: string;
  private readonly bunPath: string;
  private readonly cwd: string;
  private readonly homeDir: string;
  private readonly now: () => number;
  private readonly hooks: InstallerHooks;
  private readonly choices: InstallChoices;
  private state: InstallState;
  /** The `--skip-service` resident this process started, when there is one. */
  private resident?: ResidentHandle;

  constructor(options: InstallerOptions) {
    this.io = options.io;
    this.runner = options.run;
    this.flags = options.flags;
    this.shellDir = resolve(options.shellDir);
    this.bunPath = options.bunPath;
    this.cwd = options.cwd;
    this.homeDir = options.homeDir;
    this.now = options.now ?? Date.now;
    this.hooks = options.hooks ?? {};
    this.choices = {
      dataDir: resolve(this.flags.dataDir ?? join(this.homeDir, '.cogmem', 'companion')),
      workspaceRoot: resolve(this.flags.workspace ?? this.cwd),
      projectId: this.flags.project ?? 'companion',
      agentId: this.flags.agent ?? 'cogmem-companion',
      httpPort: this.flags.httpPort ?? 7338,
      platform: this.flags.platform ?? options.platform,
      serviceName: this.flags.serviceName ?? 'cogmem-companion',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      dreamStartHour: 2,
      dreamEndHour: 5,
      quietStartHour: null,
      quietEndHour: null,
      model: { provider: 'mg', baseUrl: MG_DEFAULT_BASE_URL, model: MG_DEFAULT_MODEL },
    };
    this.state = this.loadState();
    // Resumed choices win over the process defaults, so a re-run from another directory still points
    // at the same data dir, workspace and rhythm the first run chose.
    Object.assign(this.choices, this.state.choices);
    this.choices.dataDir = resolve(this.choices.dataDir);
    this.choices.workspaceRoot = resolve(this.choices.workspaceRoot);
  }

  private get statePath(): string {
    return join(this.choices.dataDir, 'install.json');
  }

  private get envPath(): string {
    return join(this.choices.dataDir, 'env');
  }

  /** Where user-defined routes live (0600). The mg route is never written here. */
  private get routesPath(): string {
    return join(this.choices.dataDir, 'routes.json');
  }

  private get dbPath(): string {
    return join(this.choices.dataDir, 'memory.sqlite');
  }

  private get socketPath(): string {
    return join(this.choices.dataDir, 'attach.sock');
  }

  private get logPath(): string {
    return join(this.choices.dataDir, 'service.log');
  }

  private get healthUrl(): string {
    return `http://127.0.0.1:${this.choices.httpPort}/health`;
  }

  private loadState(): InstallState {
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf8')) as InstallState;
      if (raw && raw.schema === 1 && Array.isArray(raw.done)) return raw;
    } catch {
      // No state yet, or an unreadable one: a fresh install starts at step 0.
    }
    return { schema: 1, done: [], choices: {}, updatedAt: this.now() };
  }

  private saveState(): void {
    mkdirSync(this.choices.dataDir, { recursive: true, mode: 0o700 });
    this.state.choices = { ...this.state.choices, ...this.choices, model: { ...this.choices.model } };
    this.state.updatedAt = this.now();
    writeFileSync(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
  }

  /** The env file is the one place the model key lives. Mode 0600, merged, never printed. */
  private writeEnvFile(patch: Record<string, string>): void {
    const merged = { ...parseEnvFile(this.envPath), ...patch };
    writeFileSync(this.envPath, serializeEnvFile(merged), { mode: 0o600 });
    chmodSync(this.envPath, 0o600);
  }

  async run(): Promise<number> {
    if (this.flags.help) {
      this.io.say(INSTALL_USAGE);
      return 0;
    }
    if (this.flags.uninstall) return this.uninstall();

    this.io.say('Cogmem 自有智能体安装引导（F21）');
    this.io.say(`平台：${this.choices.platform}（macOS / Linux；Windows 的服务化不在本轮）`);
    this.io.say('安全口径：所有服务面仅回环（127.0.0.1）；快照/数据目录 0700；模型钥匙只经安全输入进 0600 配置文件，不打印、不进日志。');
    this.io.say('全新安装：无旧安装分流、无记忆继承、无迁移分支。');
    mkdirSync(this.choices.dataDir, { recursive: true, mode: 0o700 });

    const steps: Record<InstallStepId, () => Promise<StepResult>> = {
      preflight: () => this.stepPreflight(),
      place: () => this.stepPlace(),
      model: () => this.stepModel(),
      rhythm: () => this.stepRhythm(),
      resident: () => this.stepResident(),
      awake: () => this.stepAwake(),
    };

    for (const [index, step] of INSTALL_STEPS.entries()) {
      if (this.state.done.includes(step)) {
        this.io.say(`\n== ${index + 1}/6 ${STEP_LABELS[step]}（已完成，跳过）==`);
        continue;
      }
      this.io.say(`\n== ${index + 1}/6 ${STEP_LABELS[step]} ==`);
      let result: StepResult;
      try {
        result = await steps[step]();
      } catch (error) {
        result = { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      if (!result.ok) {
        this.state.failedAt = step;
        this.saveState();
        this.io.say(`\n[干净停在 ${index + 1}/6：${STEP_LABELS[step]}]`);
        this.io.say(`原因：${result.message}`);
        if (result.hint) this.io.say(`下一步：${result.hint}`);
        this.io.say(`修好后重跑本安装器，会从第 ${index + 1} 步续装。`);
        return 1;
      }
      this.state.done.push(step);
      delete this.state.failedAt;
      this.saveState();
    }

    this.io.say('\n安装完成：六步全过，首醒自检探针通过。');
    this.io.say(`终端运行 cog 附着：${this.bunPath} run ${join(this.shellDir, 'src', 'cog.ts')} --data ${this.choices.dataDir} --workspace ${this.choices.workspaceRoot}`);
    return 0;
  }

  private async uninstall(): Promise<number> {
    this.io.say('卸载：停服务、摘单元、保留记忆库。');
    await uninstallService(this.runner, this.serviceSpec(), this.choices.platform as Platform);
    this.stopResident();
    this.io.say(`记忆库保留在 ${this.dbPath}；要连数据一起删，手动删目录 ${this.choices.dataDir}。`);
    return 0;
  }

  // ── Step 0: 预检 ──────────────────────────────────────────────────────────

  private async stepPreflight(): Promise<StepResult> {
    if (this.choices.platform !== 'linux' && this.choices.platform !== 'darwin') {
      return {
        ok: false,
        message: `不支持的平台：${this.choices.platform}`,
        hint: '本安装引导只服务 macOS / Linux；Windows 的服务化不在本轮。',
      };
    }

    const uname = await this.runner('uname', ['-srm']);
    if (uname.code !== 0) {
      return { ok: false, message: `环境探测失败：uname 退出 ${uname.code}`, hint: uname.stderr.trim() };
    }
    this.io.say(`系统：${uname.stdout.trim()}`);

    const bunVersion = await this.runner(this.bunPath, ['--version']);
    const version = bunVersion.stdout.trim();
    const major = Number(version.split('.')[0]);
    if (bunVersion.code !== 0 || !(major >= 1)) {
      return { ok: false, message: `运行时不可用：bun ${version || '?'}（退出 ${bunVersion.code}）`, hint: `安装 bun 1.x，或把 --bun 指向它；当前用的 ${this.bunPath}` };
    }
    this.io.say(`运行时：bun ${version} (${this.bunPath})`);

    try {
      const fs = statfsSync(this.choices.dataDir);
      const free = Number(fs.bavail) * Number(fs.bsize);
      this.io.say(`磁盘：${this.choices.dataDir} 可用 ${formatBytes(free)}`);
      if (free < 512 * 1024 * 1024) {
        return { ok: false, message: `磁盘可用空间不足：${formatBytes(free)}`, hint: '腾出至少 512 MB；记忆库与快照都写在这里。' };
      }
    } catch (error) {
      this.io.say(`磁盘：无法探测（${error instanceof Error ? error.message : String(error)}），跳过`);
    }

    const portState = await this.portState(this.choices.httpPort);
    if (portState === 'taken') {
      return {
        ok: false,
        message: `端口 ${this.choices.httpPort} 已被别的进程占用（回环地址不通 health，也不是本壳）`,
        hint: `换一个端口：--http-port <n>；或先停掉占用者。`,
      };
    }
    this.io.say(`端口：127.0.0.1:${this.choices.httpPort} ${portState === 'ours' ? '已有本壳在跑（续装）' : '空闲'}`);
    return { ok: true };
  }

  /** `ours` when the port answers this service's /health, `free` when bindable, `taken` otherwise. */
  private async portState(port: number): Promise<'free' | 'ours' | 'taken'> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) {
        const body = (await response.json()) as { service?: string };
        if (body.service === 'cogmem-companion-shell') return 'ours';
      }
      return 'taken';
    } catch {
      // Nothing answered; try to bind it ourselves.
    }
    try {
      const probe = Bun.serve({ port, hostname: '127.0.0.1', fetch: () => new Response('') });
      probe.stop(true);
      return 'free';
    } catch {
      return 'taken';
    }
  }

  // ── Step 1: 落位 ──────────────────────────────────────────────────────────

  private async stepPlace(): Promise<StepResult> {
    const cliEntry = join(this.shellDir, 'src', 'cli.ts');
    if (!existsSync(cliEntry)) {
      return { ok: false, message: `找不到壳程序：${cliEntry}`, hint: '在 spike 工作区里跑安装器，或用 --shell <dir> 指向壳的根目录。' };
    }
    if (!existsSync(join(this.shellDir, 'node_modules'))) {
      this.io.say('装包：bun install --frozen-lockfile …');
      const install = await this.runner(this.bunPath, ['install', '--frozen-lockfile'], { cwd: this.shellDir, timeoutMs: 10 * 60_000 });
      if (install.code !== 0) {
        return { ok: false, message: `装包失败（bun install 退出 ${install.code}）`, hint: install.stderr.trim().slice(0, 400) };
      }
    } else {
      this.io.say('装包：依赖已就位（node_modules 存在）');
    }

    mkdirSync(this.choices.dataDir, { recursive: true, mode: 0o700 });
    chmodSync(this.choices.dataDir, 0o700);
    const snapshots = join(this.choices.dataDir, 'snapshots');
    mkdirSync(snapshots, { recursive: true, mode: 0o700 });
    chmodSync(snapshots, 0o700);
    this.io.say(`数据目录：${this.choices.dataDir}（0700，快照目录 ${snapshots}）`);

    // 空库初始化 through the kernel's own API — migrations and schema come from the kernel, not here.
    const kernel = createMemoryKernel({ dbPath: this.dbPath, projectTimeZone: this.choices.timeZone });
    try {
      const health = kernel.getHealthStatus();
      this.io.say(`空库初始化：${health.dbPath}`);
    } finally {
      kernel.close();
    }

    const row = writeDefaultSoul(this.dbPath, this.choices.agentId, this.now());
    const readBack = readSoul(this.dbPath, this.choices.agentId);
    if (!readBack || readBack.content !== DEFAULT_SOUL) {
      return { ok: false, message: '默认 soul 写入后读不回（逐字比对不一致）', hint: `检查 ${this.dbPath} 的写权限。` };
    }
    this.io.say(`默认 soul：v${row.version}，${Buffer.byteLength(row.content)} 字节，逐字读回一致`);
    return { ok: true };
  }

  // ── Step 2: 模型 ──────────────────────────────────────────────────────────

  private async stepModel(): Promise<StepResult> {
    let provider = this.choices.model.provider;
    let baseUrl = this.choices.model.baseUrl;
    let model = this.choices.model.model;
    let routeName = 'custom';
    let apiKey = parseEnvFile(this.envPath).MG_API_KEY ?? '';

    if (!this.flags.yes) {
      const picked = await this.io.ask('provider（mg=本机网关 / openai_compatible=自填端点）', {
        default: provider,
        choices: ['mg', 'openai_compatible'],
      });
      provider = (picked === 'openai_compatible' ? 'openai_compatible' : 'mg') as ModelProviderKind;
      baseUrl = await this.io.ask('base URL（OpenAI 兼容，通常以 /v1 结尾）', { default: provider === 'mg' ? MG_DEFAULT_BASE_URL : baseUrl || 'http://127.0.0.1:3425/v1' });
      model = await this.io.ask('模型名（自由文本，不查目录）', { default: provider === 'mg' ? MG_DEFAULT_MODEL : model || MG_DEFAULT_MODEL });
      if (MODEL_PRESETS[provider].needsKey) {
        routeName = safeRouteName(await this.io.ask('路线名（/model 切换用；mg 留给内置网关）', { default: routeName }));
        apiKey = await this.io.askSecret('模型钥匙（安全输入，不回显、不入日志）: ');
      } else {
        apiKey = apiKey || 'magpie';
        this.io.say('mg 网关在本机回环，无需真钥匙（用占位 magpie）。');
      }
    } else if (apiKey === '') {
      apiKey = 'magpie';
    }

    this.choices.model = { provider, baseUrl, model };
    const choice: ModelChoice = { provider, baseUrl, apiKey, model };
    this.io.say(`探活：向这条路线打一发真实调用（模型 ${model}）…本地网关可能要几分钟，请等它答话，不通就停在本步`);
    const probe = await (this.hooks.probe ?? probeModel)(choice);
    if (!probe.ok) {
      return {
        ok: false,
        message: `模型探活失败（${probe.code}）：${probe.message}`,
        hint: `${probe.hint} 装完才发现不会说话不算装成，所以停在这里。`,
      };
    }
    this.io.say(`探活通过：${probe.latencyMs} ms，端点回了「${probe.sample}」`);
    if (provider === 'mg') {
      // The built-in route is the existing env config, untouched: no routes file is created for it.
      this.writeEnvFile(modelEnv(choice));
      this.io.say(`模型配置已写入 ${this.envPath}（0600；钥匙只在这里，不出现在任何输出里）`);
    } else {
      const route = this.saveRoute({ name: routeName, baseUrl, apiKey, model });
      this.io.say(`自定义路线「${route.name}」已写入 ${this.routesPath}（0600，钥匙只在这里）并设为当前路线。`);
      this.io.say('内置 mg 网关路线原样保留，随时可用 /model 切回。');
    }
    return { ok: true };
  }

  /** Upsert a named route and make it the active one; the file is 0600 and never printed. */
  private saveRoute(route: ModelRoute): ModelRoute {
    const store = new RouteStore(this.routesPath).load();
    const saved = store.add(route);
    store.setActive(saved.name);
    return saved;
  }

  // ── Step 3: 节律 ──────────────────────────────────────────────────────────

  private async stepRhythm(): Promise<StepResult> {
    let timeZone = this.choices.timeZone;
    let dreamStart = this.choices.dreamStartHour;
    let dreamEnd = this.choices.dreamEndHour;
    let quietStart = this.choices.quietStartHour;
    let quietEnd = this.choices.quietEndHour;

    if (!this.flags.yes) {
      timeZone = await this.io.ask('时区（IANA，如 Asia/Tokyo）', { default: timeZone });
      try {
        new Intl.DateTimeFormat('en-US', { timeZone });
      } catch {
        return { ok: false, message: `时区无法识别：${timeZone}`, hint: '用 IANA 名字，例如 Asia/Tokyo、Europe/Berlin、UTC。' };
      }
      dreamStart = hour(await this.io.ask('做梦时点：开始小时（0-23）', { default: String(dreamStart) }), dreamStart);
      dreamEnd = hour(await this.io.ask('做梦时点：结束小时（0-23）', { default: String(dreamEnd) }), dreamEnd);
      const quietRaw = await this.io.ask('勿扰窗：开始小时（留空=关）', { default: quietStart === null ? '' : String(quietStart) });
      if (quietRaw.trim() !== '') {
        quietStart = hour(quietRaw, 23);
        quietEnd = hour(await this.io.ask('勿扰窗：结束小时（0-23）', { default: String(quietEnd ?? 7) }), 7);
      } else {
        quietStart = null;
        quietEnd = null;
      }
      const confirm = await this.io.ask(
        `确认节律：时区 ${timeZone}；做梦 ${dreamStart}:00-${dreamEnd}:00；勿扰 ${quietStart === null ? '关' : `${quietStart}:00-${quietEnd}:00`}`,
        { default: 'y', choices: ['y', 'n'] },
      );
      if (confirm.toLowerCase() === 'n') {
        return { ok: false, message: '节律未确认', hint: '重跑本安装器，从第 4 步重新选。' };
      }
    }

    this.choices.timeZone = timeZone;
    this.choices.dreamStartHour = dreamStart;
    this.choices.dreamEndHour = dreamEnd;
    this.choices.quietStartHour = quietStart;
    this.choices.quietEndHour = quietEnd;
    // The resident reads TZ and the dream window from the env file. The quiet window is recorded
    // here too; nothing in the shell gates on it yet (that is F16's emergence routing), and the
    // installer says so rather than pretending the silence is wired.
    this.writeEnvFile({
      COGMEM_SHELL_TZ: timeZone,
      COGMEM_SHELL_DREAM_START: String(dreamStart),
      COGMEM_SHELL_DREAM_END: String(dreamEnd),
      ...(quietStart === null ? {} : { COGMEM_SHELL_QUIET_START: String(quietStart), COGMEM_SHELL_QUIET_END: String(quietEnd ?? 7) }),
    });
    this.io.say(`节律已写入：时区 ${timeZone}，做梦 ${dreamStart}:00-${dreamEnd}:00，勿扰 ${quietStart === null ? '关' : `${quietStart}:00-${quietEnd}:00`}`);
    if (quietStart !== null) this.io.say('（勿扰窗已记录；壳内浮现/做梦的静默闸门属 F16，尚未落地）');
    return { ok: true };
  }

  // ── Step 4: 常驻 ──────────────────────────────────────────────────────────

  private serviceSpec(): ServiceSpec {
    return {
      serviceName: this.choices.serviceName,
      bunPath: this.bunPath,
      shellDir: this.shellDir,
      dataDir: this.choices.dataDir,
      workspaceRoot: this.choices.workspaceRoot,
      projectId: this.choices.projectId,
      agentId: this.choices.agentId,
      httpPort: this.choices.httpPort,
      envFile: this.envPath,
      logFile: this.logPath,
      homeDir: this.homeDir,
      env: { ...parseEnvFile(this.envPath) },
    };
  }

  private async stepResident(): Promise<StepResult> {
    const spec = this.serviceSpec();
    if (this.flags.skipService) {
      this.io.say('常驻：--skip-service 模式，直接拉起进程（不注册用户服务）');
      this.spawnResident();
      this.saveState();
    } else {
      const installed = await installService(this.runner, spec, this.choices.platform as Platform);
      this.io.say(`服务单元：${installed.path}`);
      this.io.say(`开机自启：${installed.autostart}`);
    }

    const health = await this.waitForHealth();
    if (!health) {
      return {
        ok: false,
        message: `常驻进程在 40 秒内没有回 health（${this.healthUrl}）`,
        hint: `看日志 ${this.logPath}；也确认 ${this.choices.httpPort} 没被占。`,
      };
    }
    this.io.say(`常驻已起：state=${health.state ?? '?'} kernel=${health.kernel?.status ?? '?'} db=${health.kernel?.dbPath ?? '?'}`);

    this.io.say('doctor 全检：');
    const report = await this.doctor();
    for (const check of report.checks) this.io.say(`  ${check.ok ? 'OK  ' : 'FAIL'} ${check.id}：${check.detail}`);
    if (!report.ok) {
      return { ok: false, message: 'doctor 没有全绿', hint: `先看上面 FAIL 的项；日志 ${this.logPath}` };
    }

    this.io.say(`星海（观测台）：http://127.0.0.1:${this.choices.httpPort}/observatory/`);
    this.io.say(`健康页：${this.healthUrl}`);
    this.io.say('两处都只回环；快照目录 0700；模型钥匙只在 0600 的 env 文件里。');
    return { ok: true };
  }

  private async doctor(): Promise<DoctorReport> {
    return runDoctor({
      dataDir: this.choices.dataDir,
      dbPath: this.dbPath,
      agentId: this.choices.agentId,
      socketPath: this.socketPath,
      healthUrl: this.healthUrl,
      fetchHealth: () => (this.hooks.fetchHealth ?? defaultFetchHealth)(this.healthUrl),
      spec: this.serviceSpec(),
      platform: this.choices.platform as Platform,
      run: this.runner,
      mode: this.flags.skipService ? 'process' : 'service',
      pid: this.state.pid,
    });
  }

  private async waitForHealth(timeoutMs = 40_000): Promise<HealthPayload | undefined> {
    const fetchHealth = this.hooks.fetchHealth ?? defaultFetchHealth;
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      try {
        const health = await fetchHealth(this.healthUrl);
        if (health.status === 'ok') return health;
      } catch {
        // Not up yet.
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    return undefined;
  }

  // ── Step 5: 自检式首醒 ────────────────────────────────────────────────────

  private async stepAwake(): Promise<StepResult> {
    const token = `install-probe-${randomUUID().slice(0, 8)}`;
    const openProbe = this.hooks.openProbe ?? openProbeSession;
    const probe = await openProbe(this.socketPath);
    const wrote = await probe.remember(`安装自检记忆：口令 ${token}，备用钥匙放在蓝色花盆下面。`, token);
    probe.close();
    if (!wrote.ok) {
      return { ok: false, message: `落账失败：${wrote.text.slice(0, 300)}`, hint: `resident health ${this.healthUrl}` };
    }
    this.io.say(`落账：${token}（经常驻的 attach 控制口写进它的内核，单一写者）`);

    this.io.say('重启进程…');
    await this.restartResident();
    if (!(await this.waitForHealth())) {
      return { ok: false, message: '重启后进程没有回 health', hint: `日志 ${this.logPath}` };
    }

    const after = await openProbe(this.socketPath);
    const recalled = await after.recall(token);
    after.close();
    if (!recalled.ok || !recalled.text.includes(token)) {
      return {
        ok: false,
        message: `重启后召回没有对上（${token} 不在召回结果里）`,
        hint: '这不是装好了：记忆没有跨进程活下来，或召回链路没通。',
      };
    }
    this.io.say(`召回对上：重启后仍能召回 ${token}`);
    return { ok: true };
  }

  private async restartResident(): Promise<void> {
    if (this.flags.skipService) {
      this.stopResident();
      this.spawnResident();
      this.saveState();
      return;
    }
    await restartService(this.runner, this.serviceSpec(), this.choices.platform as Platform);
  }

  private spawnResident(): void {
    const args = residentArgs(this.serviceSpec());
    if (this.hooks.spawnResident) {
      this.resident = this.hooks.spawnResident(args, parseEnvFile(this.envPath), this.choices.workspaceRoot);
    } else {
      const child = spawn(this.bunPath, args.slice(1), {
        cwd: this.choices.workspaceRoot,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...parseEnvFile(this.envPath), COGMEM_SHELL_ATTACH: 'on' },
      });
      child.unref();
      this.resident = { pid: child.pid ?? 0, kill: () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } } };
    }
    this.state.pid = this.resident.pid;
  }

  /**
   * Stop the resident this process started, by handle — not by `process.kill(pid)` on a number that a
   * resumed run only knows from disk. A hook that returns a handle decides how it dies; a resumed run
   * with no handle falls back to the pid.
   */
  private stopResident(): void {
    if (this.resident) {
      this.resident.kill();
      this.resident = undefined;
      return;
    }
    if (this.state.pid) {
      try {
        process.kill(this.state.pid, 'SIGTERM');
      } catch {
        // Already gone: a restart is what the caller wanted either way.
      }
    }
  }
}

export async function defaultFetchHealth(url: string): Promise<HealthPayload> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`health HTTP ${response.status}`);
  return (await response.json()) as HealthPayload;
}

export const INSTALL_USAGE = [
  '用法: install [--data <dir>] [--workspace <dir>] [--project <id>] [--agent <id>]',
  '              [--http-port <n>] [--service-name <name>] [--home <dir>] [--platform linux|darwin]',
  '              [--yes] [--skip-service] [--uninstall] [--help]',
  '  --data         数据目录（默认 ~/.cogmem/companion）',
  '  --yes          非交互：取默认（mg 网关、系统时区、做梦 2:00-5:00）',
  '  --skip-service 不注册用户服务，直接拉起进程（无 systemd/launchd 的沙箱）',
  '  --uninstall    停服务、摘单元；记忆库保留',
].join('\n');

/** Boolean flags take no value; everything else consumes the next token. */
const BOOLEAN_FLAGS = new Set(['yes', 'skip-service', 'uninstall', 'help']);

export function parseInstallFlags(argv: string[]): InstallFlags {
  const flags: InstallFlags = {};
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    if (index === -1) return undefined;
    const next = argv[index + 1];
    return next && !next.startsWith('--') ? next : undefined;
  };
  for (const name of BOOLEAN_FLAGS) if (argv.includes(`--${name}`)) (flags as Record<string, unknown>)[name.replace(/-([a-z])/gu, (_, char: string) => char.toUpperCase())] = true;
  const stringFlags: Array<[string, keyof InstallFlags]> = [
    ['data', 'dataDir'],
    ['workspace', 'workspace'],
    ['project', 'project'],
    ['agent', 'agent'],
    ['platform', 'platform'],
    ['service-name', 'serviceName'],
    ['home', 'homeDir'],
    ['shell', 'shell'],
  ];
  for (const [name, key] of stringFlags) {
    const parsed = value(name);
    if (parsed !== undefined) (flags as Record<string, unknown>)[key] = parsed;
  }
  const port = value('http-port');
  if (port !== undefined) flags.httpPort = Number(port);
  return flags;
}

/** The process entry. `shell/bin/install` is a two-line shim over this. */
export async function runInstallCli(argv: string[], streams?: TerminalStreams): Promise<number> {
  const resolvedStreams = streams ?? { input: process.stdin, output: process.stdout };
  const flags = parseInstallFlags(argv);
  if (flags.help) {
    resolvedStreams.output.write(`${INSTALL_USAGE}\n`);
    return 0;
  }
  const io = createTerminalIO(resolvedStreams);
  const shellDir = resolve(flags.shell ?? fileURLToPath(new URL('../..', import.meta.url)));
  const installer = new Installer({
    io,
    run: defaultRunner(),
    flags,
    shellDir,
    bunPath: process.execPath,
    cwd: process.cwd(),
    platform: process.platform,
    homeDir: flags.homeDir ? resolve(flags.homeDir) : homedir(),
  });
  try {
    return await installer.run();
  } finally {
    io.close();
  }
}
