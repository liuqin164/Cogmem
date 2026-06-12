export interface ConversationTurn {
  turn: number;
  createdAt: number;
  type: 'chat' | 'doc' | 'agent_observation';
  content: string;
  groundTruth: string[];
  scene: 'normal' | 'approval_pause' | 'context_switch' | 'critical_anchor';
  factKey?: string;
  factValue?: string;
  isSuperseded?: boolean;
  canonicalFactKey?: string;
}

export interface RecallCase {
  id: string;
  query: string;
  relevantPhrases: string[];
  supersededPhrases: string[];
  canonicalPhrases: string[];
  minimalContext: string[];
  anchorTurn: number;
  critical: boolean;
}

export interface ConversationDataset {
  name: string;
  projectId: string;
  turns: 10 | 50 | 200;
  history: string[];
  conversation: ConversationTurn[];
  recallCases: RecallCase[];
  criticalFacts: Array<{ query: string; expectedPhrases: string[]; anchorTurn: number }>;
  hasApprovalPause: boolean;
  hasContextSwitch: boolean;
  startedAt: number;
}

const BASE_TIME = Date.UTC(2025, 0, 1, 9, 0, 0);

function issueDeviceLabel(index: number): string {
  return `QuietPods-${String(index).padStart(3, '0')}`;
}

function projectLabel(index: number): string {
  return `Atlas-${String(index).padStart(3, '0')}`;
}

export function generateSyntheticConversation(turns: 10 | 50 | 200): ConversationDataset {
  const conversation: ConversationTurn[] = [];
  const recallCases: RecallCase[] = [];
  const criticalFacts: ConversationDataset['criticalFacts'] = [];
  const projectId = `eval-synth-${turns}`;
  const cycleCount = Math.max(1, Math.floor(turns / 5));

  for (let cycle = 0; cycle < cycleCount; cycle += 1) {
    const baseTurn = cycle * 5;
    if (baseTurn >= turns) break;

    const device = issueDeviceLabel(cycle + 1);
    const project = projectLabel(cycle + 1);
    const createdBase = BASE_TIME + baseTurn * 60_000;
    const ticket = `AP-${String(cycle + 1).padStart(3, '0')}`;
    const beacon = `Beacon-${String(cycle + 1).padStart(3, '0')}`;

    const issueTurn: ConversationTurn = {
      turn: baseTurn + 1,
      createdAt: createdBase,
      type: 'chat',
      content: `I am debugging ${device}. The left ear has static during calls for ${project}.`,
      groundTruth: [`device:${device}`, `project:${project}`, 'issue:left_ear_static'],
      scene: cycle === 1 ? 'critical_anchor' : 'normal',
      factKey: `${device}:issue`,
      factValue: 'left ear static',
      canonicalFactKey: `${device}:issue`,
    };
    conversation.push(issueTurn);

    if (baseTurn + 1 >= turns) break;
    conversation.push({
      turn: baseTurn + 2,
      createdAt: createdBase + 60_000,
      type: 'doc',
      content: `${project} deploy constraint: use postgres primary and finish the backup checklist before release.`,
      groundTruth: [`project:${project}`, 'constraint:postgres', 'constraint:backup_first'],
      scene: 'normal',
      factKey: `${project}:constraint`,
      factValue: 'postgres backup checklist',
      canonicalFactKey: `${project}:constraint`,
    });

    if (baseTurn + 2 >= turns) break;
    conversation.push({
      turn: baseTurn + 3,
      createdAt: createdBase + 120_000,
      type: 'chat',
      content: `Approval pause for ${project}: hold deployment until CAB ticket ${ticket} is approved.`,
      groundTruth: [`project:${project}`, 'approval:paused'],
      scene: 'approval_pause',
      factKey: `${project}:approval`,
      factValue: ticket,
      canonicalFactKey: `${project}:approval`,
    });

    if (baseTurn + 3 >= turns) break;
    conversation.push({
      turn: baseTurn + 4,
      createdAt: createdBase + 180_000,
      type: 'chat',
      content: `Context switch: for ${beacon} we only track redis cache warmup, not the ${project} deploy issue.`,
      groundTruth: [`project:${beacon}`, 'context:switched'],
      scene: 'context_switch',
      factKey: `${beacon}:cache`,
      factValue: 'redis cache warmup',
      canonicalFactKey: `${beacon}:cache`,
    });

    if (baseTurn + 4 >= turns) break;
    conversation.push({
      turn: baseTurn + 5,
      createdAt: createdBase + 240_000,
      type: 'doc',
      content: `Working note for ${project}: resume from ${ticket} once backup verification is complete.`,
      groundTruth: [`project:${project}`, 'resume:approval_token'],
      scene: 'normal',
      factKey: `${project}:resume`,
      factValue: ticket,
      canonicalFactKey: `${project}:resume`,
    });

    recallCases.push({
      id: `issue-${device}`,
      query: `${device} which ear has static`,
      relevantPhrases: [device, 'left ear has static', project],
      supersededPhrases: [],
      canonicalPhrases: ['left ear has static'],
      minimalContext: [
        `I am debugging ${device}`,
        `${project} deploy constraint`,
        `Approval pause for ${project}`,
      ],
      anchorTurn: baseTurn + 1,
      critical: cycle === 1,
    });

    recallCases.push({
      id: `approval-${project}`,
      query: `${project} approval pause token`,
      relevantPhrases: [project, ticket, 'hold deployment until CAB'],
      supersededPhrases: [],
      canonicalPhrases: [ticket],
      minimalContext: [`Approval pause for ${project}`, `Working note for ${project}`],
      anchorTurn: baseTurn + 3,
      critical: cycle === 1,
    });

    if (cycle === 1) {
      criticalFacts.push({
        query: `${device} which ear has static`,
        expectedPhrases: [device, 'left ear has static'],
        anchorTurn: baseTurn + 1,
      });
      criticalFacts.push({
        query: `${project} approval pause token`,
        expectedPhrases: [project, ticket],
        anchorTurn: baseTurn + 3,
      });
    }
  }

  return {
    name: `synthetic-long-conversation-${turns}`,
    projectId,
    turns,
    history: conversation.map((turn) => turn.content),
    conversation: conversation.slice(0, turns),
    recallCases,
    criticalFacts,
    hasApprovalPause: conversation.some((turn) => turn.scene === 'approval_pause'),
    hasContextSwitch: conversation.some((turn) => turn.scene === 'context_switch'),
    startedAt: BASE_TIME,
  };
}
