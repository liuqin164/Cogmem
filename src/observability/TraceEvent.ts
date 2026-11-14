export type TraceEventType =
  | 'recall.request'
  | 'recall.result'
  | 'session.context.assemble'
  | 'confidence_gate.decision'
  | 'risk_gate.decision'
  | 'task_router.plan'
  | 'capability.invoke'
  | 'capability.result'
  | 'observation_filter.decision'
  | 'memory.promote'
  | 'memory.topic_reclassified'
  | 'approval.request'
  | 'approval.resolve'
  | 'task_state.transition'
  | 'notification_dispatch'
  | 'scheduler_job_run'
  | 'skill.loaded'
  | 'skill.unloaded'
  | 'proposal.approved'
  | 'proposal.apply'
  | 'proposal.rollback'
  | 'proposal.rejected'
  | 'autonomy.action_approved'
  | 'autonomy.action_rejected'
  | 'autonomy.batch_collected'
  | 'autonomy.budget_exhausted'
  | 'procedure.started'
  | 'procedure.step.started'
  | 'procedure.step.executed'
  | 'procedure.step.failed'
  | 'procedure.step.retried'
  | 'procedure.step.skipped'
  | 'procedure.step.pending_approval'
  | 'procedure.step.requires_control'
  | 'procedure.approval_flushed'
  | 'procedure.resume_consumed'
  | 'procedure.completed'
  | 'procedure.failed'
  | 'runtime_self.projected'
  | 'runtime_self.refreshed'
  | 'runtime_self.diff'
  | 'runtime_self.failed';

export interface TraceEvent {
  id: string;
  timestamp: number;
  taskId?: string;
  projectId?: string;
  eventType: TraceEventType;
  payload: Record<string, unknown>;
  parentEventId?: string;
}
