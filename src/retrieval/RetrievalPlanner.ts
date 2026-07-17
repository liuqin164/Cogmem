import type { QueryIR } from '../types/query-ir.js';

export type RetrievalIntent =
  | 'fact_lookup'
  | 'preference_lookup'
  | 'decision_lookup'
  | 'trace'
  | 'constraint_lookup'
  | 'debug_context'
  | 'recall';

export interface RetrievalExecutionPlan {
  intent: RetrievalIntent;
  routeOrder: Array<'beliefs' | 'vector' | 'fts' | 'graph'>;
  topK: {
    beliefs: number;
    vector: number;
    fts: number;
    graph: number;
  };
  weights: {
    beliefs: number;
    vector: number;
    fts: number;
    graph: number;
  };
  aggregation: {
    strategy: 'belief_first' | 'weighted_fusion' | 'graph_expansion' | 'fts_backfill';
    suppressSupersededBeliefs: boolean;
    suppressArchivedNeurons: boolean;
  };
  filters: {
    projectId?: string;
    filePath?: string;
    fileType?: string;
    temporal: QueryIR['temporal'];
    mustMatch: string[];
    shouldMatch: string[];
    semantics: QueryIR['semantics'];
  };
  diagnostics: {
    plannerVersion: 'v0.3';
    reasons: string[];
  };
}

export class RetrievalPlanner {
  plan(ir: QueryIR): RetrievalExecutionPlan {
    const normalizedQuery = ir.rawQuery.toLowerCase();
    const intent = this.inferIntent(ir, normalizedQuery);

    const plan: RetrievalExecutionPlan = {
      intent,
      routeOrder: ['vector', 'fts', 'graph', 'beliefs'],
      topK: { beliefs: 6, vector: 24, fts: 10, graph: 8 },
      weights: { beliefs: 0.2, vector: 0.5, fts: 0.18, graph: 0.12 },
      aggregation: {
        strategy: 'weighted_fusion',
        suppressSupersededBeliefs: true,
        suppressArchivedNeurons: true
      },
      filters: {
        projectId: ir.spatial.projectId,
        filePath: ir.spatial.filePath,
        fileType: ir.spatial.fileType,
        temporal: ir.temporal,
        mustMatch: ir.mustMatch,
        shouldMatch: ir.shouldMatch,
        semantics: ir.semantics
      },
      diagnostics: {
        plannerVersion: 'v0.3',
        reasons: []
      }
    };

    switch (intent) {
      case 'trace':
        plan.routeOrder = ['graph', 'vector', 'fts', 'beliefs'];
        plan.topK = { beliefs: 4, vector: 36, fts: 12, graph: 18 };
        plan.weights = { beliefs: 0.05, vector: 0.35, fts: 0.15, graph: 0.45 };
        plan.aggregation.strategy = 'graph_expansion';
        plan.diagnostics.reasons.push('trace intent prioritizes graph-local expansion');
        break;
      case 'preference_lookup':
        plan.routeOrder = ['beliefs', 'vector', 'fts', 'graph'];
        plan.topK = { beliefs: 10, vector: 14, fts: 8, graph: 6 };
        plan.weights = { beliefs: 0.62, vector: 0.18, fts: 0.12, graph: 0.08 };
        plan.aggregation.strategy = 'belief_first';
        plan.diagnostics.reasons.push('preference lookup prefers canonical beliefs');
        break;
      case 'decision_lookup':
        plan.routeOrder = ['beliefs', 'graph', 'vector', 'fts'];
        plan.topK = { beliefs: 8, vector: 16, fts: 8, graph: 12 };
        plan.weights = { beliefs: 0.5, vector: 0.14, fts: 0.08, graph: 0.28 };
        plan.aggregation.strategy = 'belief_first';
        plan.diagnostics.reasons.push('decision lookup requires belief plus supporting episodes');
        break;
      case 'fact_lookup':
      case 'constraint_lookup':
        plan.routeOrder = ['beliefs', 'fts', 'vector', 'graph'];
        plan.topK = { beliefs: 10, vector: 16, fts: 14, graph: 6 };
        plan.weights = { beliefs: 0.55, vector: 0.14, fts: 0.23, graph: 0.08 };
        plan.aggregation.strategy = 'belief_first';
        plan.diagnostics.reasons.push('fact/constraint lookup uses belief-first with lexical backfill');
        break;
      case 'debug_context':
        plan.routeOrder = ['vector', 'graph', 'fts', 'beliefs'];
        plan.topK = { beliefs: 5, vector: 30, fts: 10, graph: 14 };
        plan.weights = { beliefs: 0.08, vector: 0.42, fts: 0.18, graph: 0.32 };
        plan.diagnostics.reasons.push('debug context prefers vector plus graph evidence');
        break;
      case 'recall':
      default:
        plan.diagnostics.reasons.push('generic recall uses weighted fusion');
        break;
    }

    if (ir.mustMatch.length > 0) {
      plan.topK.fts += 6;
      plan.weights.fts += 0.08;
      plan.weights.vector -= 0.04;
      plan.weights.graph -= 0.04;
      plan.diagnostics.reasons.push('mustMatch raises lexical recall priority');
    }

    if (ir.semantics.entityHints.length > 0 && plan.routeOrder.includes('beliefs')) {
      plan.topK.beliefs += 2;
      plan.weights.beliefs += 0.05;
      plan.weights.vector -= 0.03;
      plan.weights.graph -= 0.02;
      plan.diagnostics.reasons.push('semantic entity hints boost structured belief recall');
    }

    if (ir.semantics.asksForHistory) {
      plan.topK.graph += 4;
      plan.weights.graph += 0.06;
      plan.weights.beliefs += 0.02;
      plan.weights.vector -= 0.04;
      plan.weights.fts -= 0.04;
      plan.diagnostics.reasons.push('history-oriented query increases graph and belief history weight');
    }

    if (ir.temporal.start !== undefined || ir.temporal.end !== undefined || ir.temporal.relative) {
      plan.topK.fts += 2;
      plan.topK.vector += 4;
      plan.weights.fts += 0.03;
      plan.weights.vector += 0.02;
      plan.weights.graph -= 0.03;
      plan.weights.beliefs -= 0.02;
      plan.diagnostics.reasons.push('temporal hint boosts time-verifiable channels');
    }

    if (ir.spatial.projectId || ir.spatial.filePath || ir.spatial.fileType) {
      plan.topK.fts += 4;
      plan.weights.fts += 0.04;
      plan.weights.vector -= 0.02;
      plan.weights.graph -= 0.02;
      plan.diagnostics.reasons.push('project/file hint boosts exact-match recall');
    }

    if (ir.semantics.conditionHints.length > 0) {
      plan.topK.beliefs += 3;
      plan.weights.beliefs += 0.07;
      plan.weights.vector -= 0.03;
      plan.weights.fts -= 0.04;
      plan.diagnostics.reasons.push('condition hints boost conditional belief retrieval');
    }

    if (ir.semantics.environmentHints.length > 0 || ir.semantics.stateHints.length > 0 || ir.semantics.policyHints.length > 0) {
      plan.topK.beliefs += 2;
      plan.weights.beliefs += 0.05;
      plan.weights.vector -= 0.02;
      plan.weights.fts -= 0.03;
      plan.diagnostics.reasons.push('runtime semantic hints boost field-level belief recall');
    }

    if (ir.semantics.stateHints.length > 0 && ir.semantics.policyHints.length > 0) {
      plan.topK.graph += 2;
      plan.weights.graph += 0.03;
      plan.weights.vector -= 0.01;
      plan.weights.fts -= 0.02;
      plan.diagnostics.reasons.push('state+policy hints boost execution-graph retrieval');
    }

    if (
      ir.semantics.guardHints.length > 0
      || ir.semantics.executorHints.length > 0
      || ir.semantics.validationHints.length > 0
      || ir.semantics.mergeHints.length > 0
    ) {
      plan.topK.beliefs += 3;
      plan.topK.graph += 2;
      plan.weights.beliefs += 0.06;
      plan.weights.graph += 0.03;
      plan.weights.vector -= 0.04;
      plan.weights.fts -= 0.05;
      plan.diagnostics.reasons.push('execution field hints boost field-level plan belief retrieval');
    }

    if (/(execute|executor|执行|validate|校验|merge|传播)/i.test(ir.rawQuery)) {
      plan.topK.beliefs += 2;
      plan.topK.graph += 2;
      plan.weights.beliefs += 0.04;
      plan.weights.graph += 0.03;
      plan.weights.vector -= 0.03;
      plan.weights.fts -= 0.04;
      plan.diagnostics.reasons.push('execution-oriented query boosts plan runtime retrieval');
    }

    if (ir.semantics.predicateHint === 'graph') {
      plan.routeOrder = ['beliefs', 'graph', 'fts', 'vector'];
      plan.topK.graph += 6;
      plan.weights.graph += 0.08;
      plan.weights.vector -= 0.05;
      plan.weights.fts -= 0.03;
      plan.diagnostics.reasons.push('graph semantic hint prioritizes graph-shaped fact retrieval');
    }

    if (ir.semantics.predicateHint === 'sequence') {
      plan.routeOrder = ['beliefs', 'fts', 'graph', 'vector'];
      plan.topK.beliefs += 3;
      plan.weights.beliefs += 0.08;
      plan.weights.vector -= 0.04;
      plan.weights.graph -= 0.04;
      plan.diagnostics.reasons.push('sequence semantic hint prioritizes workflow sequence beliefs');
    }

    if (ir.semantics.predicateHint === 'plan') {
      plan.routeOrder = ['beliefs', 'graph', 'fts', 'vector'];
      plan.topK.beliefs += 4;
      plan.topK.graph += 4;
      plan.weights.beliefs += 0.1;
      plan.weights.graph += 0.06;
      plan.weights.vector -= 0.08;
      plan.weights.fts -= 0.08;
      if (ir.semantics.valueHints.length > 0) {
        plan.topK.beliefs += 2;
        plan.weights.beliefs += 0.04;
        plan.weights.vector -= 0.02;
        plan.weights.fts -= 0.02;
      }
      plan.diagnostics.reasons.push('plan semantic hint prioritizes executable plan graph beliefs');
    }

    this.normalizeWeights(plan.weights);
    return plan;
  }

  private inferIntent(ir: QueryIR, normalizedQuery: string): RetrievalIntent {
    if (ir.intentType === 'trace') return 'trace';
    if (/(喜欢|讨厌|偏好|prefer|preference|dislike)/i.test(normalizedQuery)) return 'preference_lookup';
    if (/(决定|选择|choose|decision|decide)/i.test(normalizedQuery)) return 'decision_lookup';
    if (/(约束|限制|必须|不能|constraint|rule)/i.test(normalizedQuery)) return 'constraint_lookup';
    if (/(事实|配置|地址|api|endpoint|what is|which)/i.test(normalizedQuery)) return 'fact_lookup';
    if (/(debug|bug|error|exception|报错)/i.test(normalizedQuery)) return 'debug_context';
    return 'recall';
  }

  private normalizeWeights(weights: RetrievalExecutionPlan['weights']): void {
    const total = weights.beliefs + weights.vector + weights.fts + weights.graph;
    if (total <= 0) return;
    weights.beliefs /= total;
    weights.vector /= total;
    weights.fts /= total;
    weights.graph /= total;
  }
}
