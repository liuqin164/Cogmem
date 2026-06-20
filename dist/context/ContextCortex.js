import { randomUUID } from 'node:crypto';
const INTENT_LAYERS = {
    greeting: [],
    short_followup: ['session_state', 'turn_bridge'],
    exact_quote: ['raw_source', 'graph', 'belief'],
    decision_history: ['temporal', 'belief', 'raw_source', 'graph'],
    preference_lookup: ['belief', 'raw_source', 'graph'],
    project_status: ['belief', 'temporal', 'graph', 'raw_source'],
    debugging: ['graph', 'raw_source', 'belief', 'temporal'],
    general_memory: ['belief', 'graph', 'temporal', 'raw_source', 'vector'],
};
export class ContextCortex {
    db;
    constructor(db) {
        this.db = db;
        if (db)
            this.initializeSchema();
    }
    classifyIntent(query) {
        const text = query.trim().toLowerCase();
        if (/^(hi|hello|hey|你好|您好|早上好|晚上好|嗨)[!！。. ]*$/.test(text))
            return 'greeting';
        if (/^(继续|接着|然后呢|上面那个|刚才说的|这个呢|continue|go on|and then)[?？!！。. ]*$/.test(text))
            return 'short_followup';
        if (/原话|逐字|怎么说的|完整对话|exact quote|verbatim|word for word/.test(text))
            return 'exact_quote';
        if (/为什么.*(改|变|推翻)|何时|什么时候|之前.*决定|decision.*(change|history)|why.*change|timeline|历史/.test(text))
            return 'decision_history';
        if (/偏好|喜欢|不喜欢|边界|习惯|preference|prefer|boundary/.test(text))
            return 'preference_lookup';
        if (/项目.*(状态|进度|当前)|release status|project status|current state/.test(text))
            return 'project_status';
        if (/报错|错误|调试|根因|bug|debug|error|failure|root cause/.test(text))
            return 'debugging';
        return 'general_memory';
    }
    plan(input) {
        const intent = this.classifyIntent(input.query);
        const requestedRatio = input.maxMemoryRatio ?? input.strategy?.maxMemoryRatio ?? 0.25;
        const ratio = Math.max(0, Math.min(0.3, requestedRatio, input.strategy?.maxMemoryRatio ?? 0.3));
        const budgetTokens = Math.max(0, Math.floor(Math.max(0, input.availableTokens) * ratio));
        const intentLayers = input.topicRelation === 'new'
            ? INTENT_LAYERS[intent].filter((layer) => layer !== 'session_state' && layer !== 'turn_bridge')
            : INTENT_LAYERS[intent];
        const strategyLayers = input.strategy
            ? [...input.strategy.primaryLayers, ...input.strategy.secondaryLayers]
            : intentLayers;
        const allowedLayers = strategyLayers.filter((layer) => intentLayers.includes(layer));
        const selected = [];
        const selectedReceipt = [];
        const suppressed = [];
        const seen = new Set();
        let usedTokens = 0;
        const eligible = [];
        for (const candidate of input.candidates) {
            const hardReason = this.hardSuppressionReason(candidate, input, intent);
            if (hardReason) {
                suppressed.push({ id: candidate.id, layer: candidate.layer, reason: hardReason });
                continue;
            }
            if (intent === 'greeting') {
                suppressed.push({ id: candidate.id, layer: candidate.layer, reason: 'intent_suppresses_memory' });
                continue;
            }
            if (!allowedLayers.includes(candidate.layer)) {
                suppressed.push({ id: candidate.id, layer: candidate.layer, reason: 'layer_not_activated' });
                continue;
            }
            if (seen.has(candidate.id)) {
                suppressed.push({ id: candidate.id, layer: candidate.layer, reason: 'duplicate' });
                continue;
            }
            seen.add(candidate.id);
            eligible.push({ candidate, tokens: this.estimateTokens(candidate) });
        }
        eligible.sort((a, b) => {
            const layerDelta = allowedLayers.indexOf(a.candidate.layer) - allowedLayers.indexOf(b.candidate.layer);
            return layerDelta || (b.candidate.confidence ?? 0.5) - (a.candidate.confidence ?? 0.5) || a.candidate.id.localeCompare(b.candidate.id);
        });
        for (const item of eligible) {
            if (usedTokens + item.tokens > budgetTokens) {
                suppressed.push({ id: item.candidate.id, layer: item.candidate.layer, reason: 'budget_exceeded' });
                continue;
            }
            selected.push(item.candidate);
            usedTokens += item.tokens;
            selectedReceipt.push({
                id: item.candidate.id,
                layer: item.candidate.layer,
                tokens: item.tokens,
                reason: input.strategy ? `activated_for:${intent}:${input.strategy.templateId}` : `activated_for:${intent}`,
            });
        }
        const receipt = {
            receiptId: `context-${randomUUID()}`,
            query: input.query,
            intent,
            projectId: input.projectId,
            budgetTokens,
            usedTokens,
            strategyId: input.strategy?.capsuleId,
            strategyTemplate: input.strategy?.templateId,
            selected: selectedReceipt,
            suppressed,
            createdAt: Date.now(),
        };
        this.persistReceipt(receipt);
        return { intent, budgetTokens, usedTokens, selected, receipt, strategy: input.strategy };
    }
    getReceipt(receiptId) {
        if (!this.db)
            return null;
        const row = this.db.prepare(`SELECT receipt_json FROM context_activation_receipts WHERE receipt_id = ?`).get(receiptId);
        return row ? JSON.parse(row.receipt_json) : null;
    }
    hardSuppressionReason(candidate, input, intent) {
        if (input.projectId && candidate.projectId && candidate.projectId !== input.projectId)
            return 'project_boundary';
        if (candidate.superseded)
            return 'superseded';
        if (input.currentSessionId && candidate.sessionId === input.currentSessionId
            && candidate.layer !== 'session_state' && candidate.layer !== 'turn_bridge')
            return 'current_session_echo';
        if (candidate.ownership === 'user' && !candidate.sourceRoles?.includes('user'))
            return 'user_belief_without_user_evidence';
        if (candidate.sensitive && !input.allowSensitive && intent !== 'exact_quote')
            return 'sensitive_without_need';
        return undefined;
    }
    estimateTokens(candidate) {
        if (Number.isFinite(candidate.estimatedTokens) && Number(candidate.estimatedTokens) > 0) {
            return Math.ceil(Number(candidate.estimatedTokens));
        }
        return Math.max(1, Math.ceil(candidate.content.length / 4));
    }
    persistReceipt(receipt) {
        if (!this.db)
            return;
        this.db.prepare(`
      INSERT INTO context_activation_receipts (
        receipt_id, project_id, intent, budget_tokens, used_tokens, receipt_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(receipt.receiptId, receipt.projectId ?? null, receipt.intent, receipt.budgetTokens, receipt.usedTokens, JSON.stringify(receipt), receipt.createdAt);
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_activation_receipts (
        receipt_id TEXT PRIMARY KEY, project_id TEXT, intent TEXT NOT NULL,
        budget_tokens INTEGER NOT NULL, used_tokens INTEGER NOT NULL,
        receipt_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_context_activation_project_time
        ON context_activation_receipts(project_id, created_at DESC);
    `);
    }
}
