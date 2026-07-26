// @ts-nocheck
import { describe, expect, it } from 'bun:test';
import Database from 'bun:sqlite';
import { FactCompiler } from '../src/engine/FactCompiler.js';
import { LocalSemanticCompiler } from '../src/engine/LocalSemanticCompiler.js';
import { EntityStore } from '../src/store/EntityStore.js';
import { FactStore, type FactRecord } from '../src/store/FactStore.js';
import type { Neuron } from '../src/types/index.js';

interface ExpectedFact {
  subject: string;
  predicateFamily: string;
  predicateValue?: string;
  object?: string;
  issueFamily?: string;
  confidenceFloor: number;
}

const GROUND_TRUTH: Array<{
  input: string;
  expectedFacts: ExpectedFact[];
}> = [
  {
    input: '我有一个蓝牙耳机，左耳总是断连。',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: '蓝牙耳机', confidenceFloor: 0.9 },
      { subject: 'device', predicateFamily: 'has_issue', predicateValue: '断连', object: '蓝牙耳机', issueFamily: 'connectivity_issue', confidenceFloor: 0.88 }
    ]
  },
  {
    input: '它后来还是断连。',
    expectedFacts: [
      { subject: 'device', predicateFamily: 'has_issue', predicateValue: '断连', object: '蓝牙耳机', issueFamily: 'connectivity_issue', confidenceFloor: 0.88 }
    ]
  },
  {
    input: '我又买了一个蓝牙耳机，这次右耳有杂音。',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: '蓝牙耳机', confidenceFloor: 0.9 },
      { subject: 'user', predicateFamily: 'purchased', predicateValue: 'bought', object: '蓝牙耳机', confidenceFloor: 0.92 },
      { subject: 'device', predicateFamily: 'has_issue', predicateValue: '杂音', object: '蓝牙耳机', issueFamily: 'sound_issue', confidenceFloor: 0.88 }
    ]
  },
  {
    input: '新的那个 right ear noise.',
    expectedFacts: [
      { subject: 'device', predicateFamily: 'has_issue', predicateValue: '杂音', object: '蓝牙耳机', issueFamily: 'sound_issue', confidenceFloor: 0.88 }
    ]
  },
  {
    input: '我有个 AirPods耳机',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: 'AirPods耳机', confidenceFloor: 0.9 }
    ]
  },
  {
    input: '那个耳机还是断联',
    expectedFacts: [
      { subject: 'device', predicateFamily: 'has_issue', predicateValue: '断连', object: 'AirPods耳机', issueFamily: 'connectivity_issue', confidenceFloor: 0.88 }
    ]
  },
  {
    input: '我有个键盘，输入延迟很明显。',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: '键盘', confidenceFloor: 0.9 },
      { subject: 'device', predicateFamily: 'has_issue', predicateValue: '卡顿', object: '键盘', issueFamily: 'performance_issue', confidenceFloor: 0.88 }
    ]
  },
  {
    input: '我又买了一个键盘，现在按键还是卡顿。',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: '键盘', confidenceFloor: 0.9 },
      { subject: 'user', predicateFamily: 'purchased', predicateValue: 'bought', object: '键盘', confidenceFloor: 0.92 },
      { subject: 'device', predicateFamily: 'has_issue', predicateValue: '卡顿', object: '键盘', issueFamily: 'performance_issue', confidenceFloor: 0.88 }
    ]
  },
  {
    input: '前一个键盘还是输入延迟。',
    expectedFacts: [
      { subject: 'device', predicateFamily: 'has_issue', predicateValue: '卡顿', object: '键盘', issueFamily: 'performance_issue', confidenceFloor: 0.88 }
    ]
  },
  {
    input: 'my monitor has noise.',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: 'monitor', confidenceFloor: 0.9 },
      { subject: 'device', predicateFamily: 'has_issue', predicateValue: '杂音', object: 'monitor', issueFamily: 'sound_issue', confidenceFloor: 0.88 }
    ]
  },
  {
    input: '我又买了一个鼠标，现在滚动很卡顿。',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: '鼠标', confidenceFloor: 0.9 },
      { subject: 'user', predicateFamily: 'purchased', predicateValue: 'bought', object: '鼠标', confidenceFloor: 0.92 },
      { subject: 'device', predicateFamily: 'has_issue', predicateValue: '卡顿', object: '鼠标', issueFamily: 'performance_issue', confidenceFloor: 0.88 }
    ]
  },
  {
    input: '做过支付项目。',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'worked_on', predicateValue: 'worked_on', object: '支付项目', confidenceFloor: 0.86 }
    ]
  },
  {
    input: 'worked on payment project',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'worked_on', predicateValue: 'worked_on', object: 'payment project', confidenceFloor: 0.86 }
    ]
  },
  {
    input: 'I like svelte',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'likes', predicateValue: 'like', object: 'svelte', confidenceFloor: 0.84 }
    ]
  },
  {
    input: '我讨厌 angular，不对，我喜欢 angular',
    expectedFacts: [
      { subject: 'user', predicateFamily: 'likes', predicateValue: 'like', object: 'angular', confidenceFloor: 0.84 }
    ]
  }
];

function makeNeuron(content: string, createdAt: number): Neuron {
  return {
    id: `neuron-${createdAt}`,
    content,
    prev_hash: '',
    self_hash: '',
    coordinates: { T: createdAt, S: [0, 0, 0], V: [] },
    synapses: [],
    metadata: {
      type: 'chat',
      projectId: 'compiler-unit',
      createdAt
    }
  };
}

function exactFactKey(fact: ExpectedFact | FactRecord): string {
  const predicateValue = 'predicateValue' in fact ? (fact.predicateValue || '') : '';
  const issueFamily = 'issueFamily' in fact
    ? (fact.issueFamily || '')
    : String(fact.metadata?.issueFamily || '');
  const object = 'object' in fact ? (fact.object || '') : '';
  const predicateFamily = 'predicateFamily' in fact ? fact.predicateFamily : '';
  return `${fact.subject}::${predicateFamily}::${predicateValue}::${object}::${issueFamily}`;
}

function persistNeuron(db: Database, neuron: Neuron): void {
  db.prepare(`INSERT OR REPLACE INTO neurons(id,project_id,is_deleted) VALUES(?,?,0)`)
    .run(neuron.id, neuron.metadata.projectId ?? '');
}

describe('LocalSemanticCompiler abstract relation coverage', () => {
  it('computes exact fact-level precision and recall across devices, projects, and preferences', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,is_deleted INTEGER NOT NULL DEFAULT 0)`);
    const factStore = new FactStore(db);
    const entityStore = new EntityStore(db);
    const factCompiler = new FactCompiler(factStore, entityStore);
    const semanticCompiler = new LocalSemanticCompiler();
    const expectedFactKeys: string[] = [];
    const predictedFactKeys: string[] = [];

    GROUND_TRUTH.forEach((item, index) => {
      const neuron = makeNeuron(item.input, Date.UTC(2025, 0, 1, 0, 0, index));
      persistNeuron(db, neuron);
      const semanticCompilation = semanticCompiler.compileMemory({
        text: item.input,
        projectId: 'compiler-unit',
        type: 'chat',
        createdAt: neuron.metadata.createdAt
      });
      const result = factCompiler.compile({
        neuron,
        semanticCompilation
      });

      const exactExpectedKeys = item.expectedFacts.map(exactFactKey).sort();
      const exactPredictedKeys = result.facts.map(exactFactKey).sort();

      expect(exactPredictedKeys).toEqual(exactExpectedKeys);

      for (const expected of item.expectedFacts) {
        const matched = result.facts.find((fact) => exactFactKey(fact) === exactFactKey(expected));
        if (!matched) {
          throw new Error(`Missing expected fact for input "${item.input}": ${exactFactKey(expected)}`);
        }
        expect((matched.confidence || 0) >= expected.confidenceFloor).toBe(true);
        if (expected.issueFamily) {
          expect(matched.metadata?.issueFamily).toBe(expected.issueFamily);
        }
      }

      expectedFactKeys.push(...exactExpectedKeys);
      predictedFactKeys.push(...exactPredictedKeys);
    });

    const remainingExpected = new Map<string, number>();
    for (const key of expectedFactKeys) {
      remainingExpected.set(key, (remainingExpected.get(key) || 0) + 1);
    }

    let matchedPredictions = 0;
    for (const key of predictedFactKeys) {
      const remaining = remainingExpected.get(key) || 0;
      if (remaining <= 0) continue;
      remainingExpected.set(key, remaining - 1);
      matchedPredictions += 1;
    }

    const precision = matchedPredictions / predictedFactKeys.length;
    const recall = matchedPredictions / expectedFactKeys.length;

    console.log(`compiler fact-level precision=${precision.toFixed(3)}`);
    console.log(`compiler fact-level recall=${recall.toFixed(3)}`);

    expect(Number.isFinite(precision)).toBe(true);
    expect(Number.isFinite(recall)).toBe(true);
    expect(precision).toBe(1);
    expect(recall).toBe(1);

    factStore.close();
    entityStore.close();
    db.close();
  });
});

describe('LocalSemanticCompiler realism variants', () => {
  const variants: Array<{
    name: string;
    seedInputs?: string[];
    input: string;
    expectedFacts: ExpectedFact[];
  }> = [
    {
      name: 'subject omission resolves latest seeded device issue by left-ear shorthand',
      seedInputs: ['我有一个蓝牙耳机。'],
      input: '左耳又断连了。',
      expectedFacts: [
        { subject: 'device', predicateFamily: 'has_issue', predicateValue: '断连', object: '蓝牙耳机', issueFamily: 'connectivity_issue', confidenceFloor: 0.88 }
      ]
    },
    {
      name: 'subject omission resolves generic performance issue onto seeded keyboard',
      seedInputs: ['我有一个键盘。'],
      input: '现在还是卡顿。',
      expectedFacts: [
        { subject: 'device', predicateFamily: 'has_issue', predicateValue: '卡顿', object: '键盘', issueFamily: 'performance_issue', confidenceFloor: 0.88 }
      ]
    },
    {
      name: 'single sentence multi-facts keeps purchase issue and project-link facts together',
      input: '我又买了一个蓝牙耳机，左耳断连，而且还在开发蓝牙项目。',
      expectedFacts: [
        { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: '蓝牙耳机', confidenceFloor: 0.9 },
        { subject: 'user', predicateFamily: 'purchased', predicateValue: 'bought', object: '蓝牙耳机', confidenceFloor: 0.92 },
        { subject: 'device', predicateFamily: 'has_issue', predicateValue: '断连', object: '蓝牙耳机', issueFamily: 'connectivity_issue', confidenceFloor: 0.88 },
        { subject: 'user', predicateFamily: 'worked_on', predicateValue: 'worked_on', object: '蓝牙项目', confidenceFloor: 0.86 }
      ]
    },
    {
      name: 'single sentence multi-facts keeps ownership issue and preference in one pass',
      input: '我有一个键盘，输入延迟很明显，而且我喜欢 HHKB。',
      expectedFacts: [
        { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: '键盘', confidenceFloor: 0.9 },
        { subject: 'device', predicateFamily: 'has_issue', predicateValue: '卡顿', object: '键盘', issueFamily: 'performance_issue', confidenceFloor: 0.88 },
        { subject: 'user', predicateFamily: 'likes', predicateValue: 'like', object: 'HHKB', confidenceFloor: 0.84 }
      ]
    },
    {
      name: 'self correction preserves the corrected preference only',
      input: '我不喜欢 Svelte，不对，我喜欢 Svelte',
      expectedFacts: [
        { subject: 'user', predicateFamily: 'likes', predicateValue: 'like', object: 'Svelte', confidenceFloor: 0.84 }
      ]
    },
    {
      name: 'mixed zh-en purchase and issue stays on the core relation set',
      input: 'I bought a new keyboard，现在还是 lag。',
      expectedFacts: [
        { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: 'keyboard', confidenceFloor: 0.9 },
        { subject: 'user', predicateFamily: 'purchased', predicateValue: 'bought', object: 'keyboard', confidenceFloor: 0.92 },
        { subject: 'device', predicateFamily: 'has_issue', predicateValue: '卡顿', object: 'keyboard', issueFamily: 'performance_issue', confidenceFloor: 0.88 }
      ]
    },
    {
      name: 'historical beta multi-fact sentence keeps both issue facts',
      seedInputs: ['我又买了一个新耳机。'],
      input: '新耳机右耳有杂音，配对也很慢',
      expectedFacts: [
        { subject: 'device', predicateFamily: 'has_issue', predicateValue: '杂音', object: '新耳机', issueFamily: 'sound_issue', confidenceFloor: 0.88 },
        { subject: 'device', predicateFamily: 'has_issue', predicateValue: '卡顿', object: '新耳机', issueFamily: 'performance_issue', confidenceFloor: 0.88 }
      ]
    },
    {
      name: 'historical beta explicit unseen device keeps the named entity',
      input: '我买了 NebulaPods X7，右耳有电流声',
      expectedFacts: [
        { subject: 'user', predicateFamily: 'owns', predicateValue: 'has', object: 'NebulaPods X7', confidenceFloor: 0.9 },
        { subject: 'user', predicateFamily: 'purchased', predicateValue: 'bought', object: 'NebulaPods X7', confidenceFloor: 0.92 },
        { subject: 'device', predicateFamily: 'has_issue', predicateValue: '杂音', object: 'NebulaPods X7', issueFamily: 'sound_issue', confidenceFloor: 0.88 }
      ]
    },
    {
      name: 'historical beta conflict update compiles dislike wording drift',
      input: '现在一闻到薄荷拿铁就烦',
      expectedFacts: [
        { subject: 'user', predicateFamily: 'dislikes', predicateValue: 'dislike', object: '薄荷拿铁', confidenceFloor: 0.84 }
      ]
    }
  ];

  it('matches exact fact lists for omitted subjects, multi-fact sentences, self-corrections, and mixed-language inputs', () => {
    variants.forEach((item, index) => {
      const db = new Database(':memory:');
      db.exec(`CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,is_deleted INTEGER NOT NULL DEFAULT 0)`);
      const factStore = new FactStore(db);
      const entityStore = new EntityStore(db);
      const factCompiler = new FactCompiler(factStore, entityStore);
      const semanticCompiler = new LocalSemanticCompiler();

      item.seedInputs?.forEach((seedInput, seedIndex) => {
        const neuron = makeNeuron(seedInput, Date.UTC(2025, 1, 1, 0, 0, index * 10 + seedIndex));
        persistNeuron(db, neuron);
        const semanticCompilation = semanticCompiler.compileMemory({
          text: seedInput,
          projectId: 'compiler-realism',
          type: 'chat',
          createdAt: neuron.metadata.createdAt
        });
        factCompiler.compile({ neuron, semanticCompilation });
      });

      const neuron = makeNeuron(item.input, Date.UTC(2025, 1, 1, 0, 10, index));
      persistNeuron(db, neuron);
      const semanticCompilation = semanticCompiler.compileMemory({
        text: item.input,
        projectId: 'compiler-realism',
        type: 'chat',
        createdAt: neuron.metadata.createdAt
      });
      const result = factCompiler.compile({
        neuron,
        semanticCompilation
      });

      const exactExpectedKeys = item.expectedFacts.map(exactFactKey).sort();
      const exactPredictedKeys = result.facts.map(exactFactKey).sort();

      expect(exactPredictedKeys).toEqual(exactExpectedKeys);

      for (const expected of item.expectedFacts) {
        const matched = result.facts.find((fact) => exactFactKey(fact) === exactFactKey(expected));
        if (!matched) {
          throw new Error(`Missing expected fact for realism variant "${item.name}": ${exactFactKey(expected)}`);
        }
        expect((matched.confidence || 0) >= expected.confidenceFloor).toBe(true);
        if (expected.issueFamily) {
          expect(matched.metadata?.issueFamily).toBe(expected.issueFamily);
        }
      }

      factStore.close();
      entityStore.close();
      db.close();
    });
  });
});
