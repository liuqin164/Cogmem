import type { ConversationDataset, ConversationTurn } from './synthetic_long_conversation.ts';

function buildCorrectionContent(original: ConversationTurn): string {
  const device = original.factKey?.split(':')[0] ?? 'unknown-device';
  return `Correction for ${device}: the right ear has static, not the left ear.`;
}

export function injectContradictions(base: ConversationDataset): ConversationDataset {
  const conversation = base.conversation.map((turn) => ({
    ...turn,
    groundTruth: [...turn.groundTruth],
  }));
  const recallCases = base.recallCases.map((item) => ({
    ...item,
    relevantPhrases: [...item.relevantPhrases],
    supersededPhrases: [...item.supersededPhrases],
    canonicalPhrases: [...item.canonicalPhrases],
    minimalContext: [...item.minimalContext],
  }));

  const issueTurns = conversation
    .filter((turn) => turn.factKey?.endsWith(':issue'))
    .slice(0, Math.max(1, Math.floor(base.turns / 25)));
  let insertionOffset = 0;

  for (const issueTurn of issueTurns) {
    const correctionTurn: ConversationTurn = {
      turn: issueTurn.turn + 1000 + insertionOffset,
      createdAt: issueTurn.createdAt + 30_000,
      type: 'chat',
      content: buildCorrectionContent(issueTurn),
      groundTruth: [
        ...issueTurn.groundTruth.filter((item) => item !== 'issue:left_ear_static'),
        'issue:right_ear_static',
      ],
      scene: 'normal',
      factKey: issueTurn.factKey,
      factValue: 'right ear static',
      canonicalFactKey: issueTurn.factKey,
      isSuperseded: false,
    };

    issueTurn.isSuperseded = true;
    issueTurn.factValue = 'left ear static';

    conversation.push(correctionTurn);
    insertionOffset += 1;

    const recallCase = recallCases.find((item) => item.id === `issue-${issueTurn.factKey?.split(':')[0]}`);
    if (recallCase) {
      recallCase.supersededPhrases.push('left ear has static');
      recallCase.canonicalPhrases = ['right ear has static'];
      recallCase.relevantPhrases = Array.from(
        new Set([...recallCase.relevantPhrases.filter((item) => item !== 'left ear has static'), 'right ear has static']),
      );
      recallCase.minimalContext.push(correctionTurn.content);
    }
  }

  conversation.sort((left, right) => left.createdAt - right.createdAt || left.turn - right.turn);

  return {
    ...base,
    history: conversation.map((turn) => turn.content),
    conversation,
    recallCases,
  };
}
