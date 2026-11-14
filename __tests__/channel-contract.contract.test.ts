import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CHANNEL_ACCOUNT_FIELDS,
  CHANNEL_ACCOUNT_ROLES,
  CHANNEL_API_METHODS,
  CHANNEL_CONTRACT_VERSION,
  CHANNEL_CONTRACT_VERSION_TAG,
  CHANNEL_DECISION_STEP_FIELDS,
  CHANNEL_DECISION_TRACE_FIELDS,
  CHANNEL_DELIVERY_FIELDS,
  CHANNEL_DELIVERY_OUTCOMES,
  CHANNEL_ERROR_CODES,
  CHANNEL_FACES,
  CHANNEL_INGRESS_FIELDS,
  CHANNEL_INTERRUPTIBILITY,
  CHANNEL_OWNER_ACTIVITY,
  CHANNEL_PRESENCE_FIELDS,
  CHANNEL_REACHABILITY_STATES,
  CHANNEL_REGISTRATION_FIELDS,
  CHANNEL_SURFACING_INPUT_FIELDS,
  CHANNEL_SURFACING_STRENGTHS,
  CHANNEL_TRACE_OUTCOMES,
  ChannelContract,
  channelContractVersionTag,
  type ChannelSession,
} from '../src/channel/index.js';
import { OccasionScope } from '../src/occasion/index.js';

/**
 * F12 (#166): the channel contract, asserted against `docs/channel-contract.md`.
 *
 * The discriminators are the ticket's: a declared occasion that disagrees with the registration is
 * overridden and traced; the three strengths are distinguishable and `silence` is silenced; and the
 * version field's format is pinned.
 */

const markdown = readFileSync(
  fileURLToPath(new URL('../docs/channel-contract.md', import.meta.url)),
  'utf8',
);

function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

function firstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gmu)].map((match) => match[1]!);
}

function tableRows(section: string): Array<{ first: string; cells: string[] }> {
  return [...section.matchAll(/^\|\s*([^|]+?)\s*\|(.*)\|\s*$/gmu)]
    .filter((match) => !/^-+$/.test(match[1]!.trim()))
    .map((match) => ({
      first: match[1]!.trim().replace(/`/g, ''),
      cells: match[2]!.split('|').map((cell) => cell.trim().replace(/`/g, '')),
    }));
}

describe('the contract document and the frozen lists agree', () => {
  test('the version table pins the numeric version and the tag format', () => {
    expect(firstColumn(sectionAfter('## Version (frozen)'))).toEqual(['contractVersion', 'numericVersion']);
    expect(CHANNEL_CONTRACT_VERSION).toBe(1);
    expect(CHANNEL_CONTRACT_VERSION_TAG).toBe('channel_contract.v1');
    expect(CHANNEL_CONTRACT_VERSION_TAG).toMatch(/^channel_contract\.v\d+$/);
    expect(channelContractVersionTag(7)).toBe('channel_contract.v7');
  });

  test('the four faces are exactly the frozen list', () => {
    expect(firstColumn(sectionAfter('## The four faces (frozen)'))).toEqual([...CHANNEL_FACES]);
  });

  test('the registration and ingress tables are their frozen field lists', () => {
    expect(firstColumn(sectionAfter('## Registration (frozen)'))).toEqual([...CHANNEL_REGISTRATION_FIELDS]);
    expect(firstColumn(sectionAfter('## Message in (frozen)'))).toEqual([...CHANNEL_INGRESS_FIELDS]);
  });

  test('the strength, input and delivery tables are their frozen lists', () => {
    expect(firstColumn(sectionAfter('### Strengths (frozen)'))).toEqual([...CHANNEL_SURFACING_STRENGTHS]);
    expect(firstColumn(sectionAfter('### Surfacing input (frozen)'))).toEqual([...CHANNEL_SURFACING_INPUT_FIELDS]);
    expect(firstColumn(sectionAfter('### Delivery result (frozen)'))).toEqual([...CHANNEL_DELIVERY_FIELDS]);
    expect([...CHANNEL_DELIVERY_OUTCOMES]).toEqual(['delivered', 'silenced']);
  });

  test('the presence and identity tables are their frozen lists', () => {
    expect(firstColumn(sectionAfter('### Reachability (frozen)'))).toEqual([...CHANNEL_REACHABILITY_STATES]);
    expect(firstColumn(sectionAfter('### Owner activity (frozen)'))).toEqual([...CHANNEL_OWNER_ACTIVITY]);
    expect(firstColumn(sectionAfter('### Interruptibility (frozen)'))).toEqual([...CHANNEL_INTERRUPTIBILITY]);
    expect(firstColumn(sectionAfter('### Presence fields (frozen)'))).toEqual([...CHANNEL_PRESENCE_FIELDS]);
    expect(firstColumn(sectionAfter('## Identity binding (frozen)'))).toEqual([...CHANNEL_ACCOUNT_ROLES]);
    expect(firstColumn(sectionAfter('### Account fields (frozen)'))).toEqual([...CHANNEL_ACCOUNT_FIELDS]);
  });

  test('the trace, error and API tables are their frozen lists', () => {
    expect(firstColumn(sectionAfter('## Decision trace (frozen)'))).toEqual([...CHANNEL_TRACE_OUTCOMES]);
    expect(firstColumn(sectionAfter('### Trace fields (frozen)'))).toEqual([...CHANNEL_DECISION_TRACE_FIELDS]);
    expect(firstColumn(sectionAfter('### Step fields (frozen)'))).toEqual([...CHANNEL_DECISION_STEP_FIELDS]);
    expect(firstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...CHANNEL_ERROR_CODES]);
    expect(firstColumn(sectionAfter('## API (frozen)'))).toEqual([...CHANNEL_API_METHODS]);
  });

  test('the second-channel walkthrough covers all four faces and the version', () => {
    const rows = tableRows(sectionAfter('## Second channel walkthrough: a generic IM chat'))
      .filter((row) => row.first !== 'Face');
    expect(rows.map((row) => row.first)).toEqual([...CHANNEL_FACES, 'version']);
    for (const row of rows) expect(row.cells.at(-1)).toBe('yes');
  });
});

describe('occasion comes from the registration, never from the caller', () => {
  const scope = new OccasionScope();
  const contract = new ChannelContract(scope);

  test('a declared occasion that disagrees is overridden and traced', () => {
    const session = contract.register({
      channelId: 'im:group:42',
      occasion: 'group',
      accounts: [
        { accountId: 'owner-1', role: 'owner' },
        { accountId: 'other-1', role: 'other' },
      ],
    });
    const ingress = contract.ingest(session, {
      accountId: 'owner-1',
      text: '今晚吃什么',
      at: 1_000,
      declaredOccasion: 'private',
    });
    expect(ingress.occasion).toBe('group');
    expect(ingress.occasionBinding).toBe('bound');
    expect(ingress.declaredOccasion).toBe('private');
    expect(ingress.decisionTrace.steps.find((step) => step.rule === 'occasion')?.outcome).toBe('mismatch');
    expect(ingress.decisionTrace.reason).toContain('occasion=mismatch');
  });

  test('an unknown account is other, and a forged session is refused', () => {
    const session = contract.register({
      channelId: 'im:group:43',
      occasion: 'group',
      accounts: [{ accountId: 'owner-2', role: 'owner' }],
    });
    const ingress = contract.ingest(session, { accountId: 'stranger', text: 'hello', at: 1_001 });
    expect(ingress.role).toBe('other');
    expect(ingress.decisionTrace.steps[0]?.outcome).toBe('unknown');

    const forged = { channelId: 'im:group:43', binding: session.binding } as unknown as ChannelSession;
    expect(() => contract.ingest(forged, { accountId: 'owner-2', text: 'hello' })).toThrow('channel_session_unbound');
  });

  test('an unbound occasion resolves to public, the strictest occasion', () => {
    const session = contract.register({
      channelId: 'im:public:1',
      occasion: 'public',
      accounts: [{ accountId: 'owner-3', role: 'owner' }],
    });
    const ingress = contract.ingest(session, { accountId: 'owner-3', text: 'hi', declaredOccasion: 'private' });
    expect(ingress.occasion).toBe('public');
    expect(ingress.decisionTrace.reason).toContain('occasion=mismatch');
  });
});

describe('the three strengths are distinguishable and silence never leaves', () => {
  const scope = new OccasionScope();
  const contract = new ChannelContract(scope);
  const session = contract.register({
    channelId: 'terminal',
    occasion: 'private',
    accounts: [{ accountId: 'terminal-owner', role: 'owner' }],
    reachability: 'online',
    interruptibility: 'high',
  });

  test('silence is silenced and proactive is delivered', () => {
    const silent = contract.deliver(session, { candidateId: 'surfacing:profile:p1', strength: 'silence', text: '秘密' });
    expect(silent.outcome).toBe('silenced');
    expect(silent.decisionTrace.reason).toContain('strength=silenced');
    expect(silent.decisionTrace.steps.find((step) => step.rule === 'strength')?.detail.reason).toBe('silence');

    const proactive = contract.deliver(session, { candidateId: 'surfacing:profile:p1', strength: 'proactive', text: '提醒' });
    expect(proactive.outcome).toBe('delivered');
    expect(proactive.decisionTrace.reason).toContain('strength=delivered');
    expect(proactive.decisionTrace.steps.find((step) => step.rule === 'strength')?.detail.reason).toBe('proactive_send');

    const incidental = contract.deliver(session, { candidateId: 'surfacing:profile:p1', strength: 'incidental', text: '顺便一提' });
    expect(incidental.outcome).toBe('delivered');
    expect(incidental.decisionTrace.steps.find((step) => step.rule === 'strength')?.detail.reason).toBe('incidental_mention');
  });

  test('an offline channel silences even a proactive send, and the trace names it', () => {
    contract.presence(session, { reachability: 'offline', ownerActivity: 'away', at: 2_000 });
    const delivery = contract.deliver(session, { candidateId: 'surfacing:profile:p2', strength: 'proactive', text: '提醒' });
    expect(delivery.outcome).toBe('silenced');
    expect(delivery.decisionTrace.steps.find((step) => step.rule === 'presence')?.outcome).toBe('offline');
    expect(delivery.decisionTrace.steps.find((step) => step.rule === 'strength')?.detail.reason).toBe('channel_offline');
  });
});

describe('invalid values name their error and do not register a half channel', () => {
  const contract = new ChannelContract(new OccasionScope());

  test('registration requires one owner and known values', () => {
    expect(() => contract.register({
      channelId: '',
      occasion: 'private',
      accounts: [{ accountId: 'a', role: 'owner' }],
    })).toThrow('invalid_channel_registration');
    expect(() => contract.register({
      channelId: 'x',
      occasion: 'private',
      accounts: [{ accountId: 'a', role: 'other' }],
    })).toThrow('invalid_channel_registration');
    expect(() => contract.register({
      channelId: 'x',
      occasion: 'private',
      accounts: [
        { accountId: 'a', role: 'owner' },
        { accountId: 'a', role: 'other' },
      ],
    })).toThrow('invalid_channel_registration');
  });

  test('message, presence and surfacing validate their own fields', () => {
    const session = contract.register({
      channelId: 'valid',
      occasion: 'private',
      accounts: [{ accountId: 'a', role: 'owner' }],
    });
    expect(() => contract.ingest(session, { accountId: 'a', text: '  ' })).toThrow('invalid_channel_message');
    expect(() => contract.ingest(session, { accountId: 'a', text: 'x', declaredOccasion: 'nowhere' })).toThrow('invalid_channel_message');
    expect(() => contract.presence(session, { reachability: 'maybe', ownerActivity: 'idle' })).toThrow('invalid_channel_presence');
    expect(() => contract.deliver(session, { candidateId: 'x', strength: 'shout' as never })).toThrow('invalid_channel_surfacing');
  });
});
