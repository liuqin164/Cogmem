import type { ContextIntent, ContextLayer } from '../context/ContextCortex.js';
import type { StrategyTemplate, StrategyTemplateId } from './StrategyCapsule.js';

const ALL_LAYERS: ContextLayer[] = [
  'session_state', 'turn_bridge', 'belief', 'temporal', 'graph', 'raw_source', 'vector',
];

const TEMPLATES: Record<StrategyTemplateId, StrategyTemplate> = {
  'no-memory': {
    templateId: 'no-memory', objective: 'avoid_unnecessary_memory', primaryLayers: [], secondaryLayers: [],
    retrievalPolicy: { allowedLanes: [], preferredLanes: [] }, sourcePolicy: 'not_needed', maxMemoryRatio: 0, maxItems: 0,
  },
  'continuity-only': {
    templateId: 'continuity-only', objective: 'preserve_local_turn_continuity',
    primaryLayers: ['session_state', 'turn_bridge'], secondaryLayers: [],
    retrievalPolicy: { allowedLanes: [], preferredLanes: [] }, sourcePolicy: 'not_needed', maxMemoryRatio: 0.1, maxItems: 2,
  },
  'source-first': {
    templateId: 'source-first', objective: 'recover_exact_source_evidence',
    primaryLayers: ['raw_source', 'graph'], secondaryLayers: ['belief'],
    retrievalPolicy: {
      allowedLanes: ['raw_source', 'graph', 'compiled'], preferredLanes: ['raw_source', 'graph', 'compiled'], requiredLane: 'raw_source',
    },
    sourcePolicy: 'required', maxMemoryRatio: 0.25, maxItems: 3,
  },
  'temporal-first': {
    templateId: 'temporal-first', objective: 'reconstruct_current_and_prior_decisions',
    primaryLayers: ['temporal', 'belief'], secondaryLayers: ['raw_source', 'graph'],
    retrievalPolicy: { allowedLanes: ['graph', 'compiled', 'raw_source'], preferredLanes: ['compiled', 'graph', 'raw_source'] },
    sourcePolicy: 'on_dispute', maxMemoryRatio: 0.25, maxItems: 4,
  },
  'user-belief-first': {
    templateId: 'user-belief-first', objective: 'recover_user_owned_memory_with_explicit_evidence',
    primaryLayers: ['belief', 'raw_source'], secondaryLayers: ['graph'],
    retrievalPolicy: { allowedLanes: ['compiled', 'graph', 'raw_source'], preferredLanes: ['compiled', 'raw_source', 'graph'] },
    sourcePolicy: 'on_dispute', maxMemoryRatio: 0.2, maxItems: 3,
  },
  'project-state': {
    templateId: 'project-state', objective: 'recover_current_project_state',
    primaryLayers: ['belief', 'temporal'], secondaryLayers: ['graph', 'raw_source'],
    retrievalPolicy: { allowedLanes: ['graph', 'compiled', 'raw_source'], preferredLanes: ['compiled', 'graph', 'raw_source'] },
    sourcePolicy: 'on_dispute', maxMemoryRatio: 0.25, maxItems: 4,
  },
  'graph-source': {
    templateId: 'graph-source', objective: 'trace_failure_to_connected_source_evidence',
    primaryLayers: ['graph', 'raw_source'], secondaryLayers: ['belief', 'temporal'],
    retrievalPolicy: { allowedLanes: ['graph', 'raw_source', 'compiled'], preferredLanes: ['graph', 'raw_source', 'compiled'] },
    sourcePolicy: 'on_dispute', maxMemoryRatio: 0.25, maxItems: 4,
  },
  'balanced-memory': {
    templateId: 'balanced-memory', objective: 'recover_governed_relevant_memory',
    primaryLayers: ['belief', 'graph', 'temporal'], secondaryLayers: ['raw_source', 'vector'],
    retrievalPolicy: { allowedLanes: ['graph', 'compiled', 'raw_source'], preferredLanes: ['graph', 'compiled', 'raw_source'] },
    sourcePolicy: 'fallback', maxMemoryRatio: 0.25, maxItems: 4,
  },
};

const INTENT_TEMPLATE: Record<ContextIntent, StrategyTemplateId> = {
  greeting: 'no-memory',
  short_followup: 'continuity-only',
  exact_quote: 'source-first',
  decision_history: 'temporal-first',
  preference_lookup: 'user-belief-first',
  project_status: 'project-state',
  debugging: 'graph-source',
  general_memory: 'balanced-memory',
};

export class StrategyTemplateRegistry {
  forIntent(intent: ContextIntent): StrategyTemplate {
    return this.get(INTENT_TEMPLATE[intent]);
  }

  get(templateId: StrategyTemplateId): StrategyTemplate {
    const template = TEMPLATES[templateId];
    return structuredClone(template);
  }

  excludedLayers(template: StrategyTemplate): ContextLayer[] {
    const allowed = new Set([...template.primaryLayers, ...template.secondaryLayers]);
    return ALL_LAYERS.filter((layer) => !allowed.has(layer));
  }

  list(): StrategyTemplate[] {
    return Object.keys(TEMPLATES).map((id) => this.get(id as StrategyTemplateId));
  }
}
