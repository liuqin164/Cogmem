import type { QueryCompiler } from './QueryCompiler.js';
import type { RetrievalPlanner } from './RetrievalPlanner.js';
import type { TemporalBranchSearch } from './TemporalBranchSearch.js';
import type { PulseRetrievalEngine } from './PulseRetrievalEngine.js';
import type { NarrativeRecallAssembler } from './NarrativeRecallAssembler.js';
import type { UniverseTraversalExecutor } from './UniverseTraversalExecutor.js';
import type { ProjectClockContext } from '../utils/LocalDateContext.js';

export interface UniverseNavigationResult {
  compiledQuery: ReturnType<QueryCompiler['compile']>;
  branchSearch: ReturnType<TemporalBranchSearch['search']>;
  pulse: ReturnType<PulseRetrievalEngine['run']>;
  narrative: ReturnType<NarrativeRecallAssembler['assemble']>;
  runtime: {
    path: string[];
    segments: Array<{
      stage: string;
      label: string;
      count?: number;
    }>;
  };
}

export class UniverseNavigator {
  constructor(
    private queryCompiler: QueryCompiler,
    private retrievalPlanner: RetrievalPlanner,
    private temporalBranchSearch: TemporalBranchSearch,
    private pulseRetrievalEngine: PulseRetrievalEngine,
    private narrativeRecallAssembler: NarrativeRecallAssembler,
    private traversalExecutor: UniverseTraversalExecutor
  ) {}

  navigate(input: {
    query: string;
    projectId?: string;
    startTime?: number;
    endTime?: number;
    temporalEnabled?: boolean;
    clock: Pick<ProjectClockContext, 'now' | 'localDateNow' | 'timeZone'>;
    topologyIds: string[];
    branchIds: string[];
    temporalBucketIds: string[];
    temporalNeuronIds: string[];
    graphIds: string[];
    cognitiveGraphIds: string[];
    entityNeuronIds: string[];
  }): UniverseNavigationResult {
    const compiledQuery = this.queryCompiler.compile(input.query, input.projectId, input.clock);
    const plan = this.retrievalPlanner.plan(compiledQuery.ir);
    const startTime = input.startTime ?? compiledQuery.ir.temporal.start;
    const endTime = input.endTime ?? compiledQuery.ir.temporal.end;
    const branchSearch = this.temporalBranchSearch.search({
      projectId: input.projectId,
      startTime,
      endTime,
      timeZone: input.clock.timeZone,
      temporalEnabled: input.temporalEnabled,
      temporalBucketIds: input.temporalBucketIds,
      entityNeuronIds: input.entityNeuronIds,
      // The IR only extracts entities it recognises, and an unfamiliar question
      // ("量子退相干与超导材料的能隙") yields none — which then looks exactly like
      // a query that named nothing and licensed the unrelated fallback. The query's
      // own words are the evidence that it named something, so they are included.
      terms: Array.from(new Set([
        ...compiledQuery.ir.entities,
        ...compiledQuery.ir.semantics.entityHints,
        ...compiledQuery.ir.mustMatch,
        ...compiledQuery.ir.shouldMatch,
        ...input.query.split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2)
      ]))
    });

    // A time bucket expands to every memory recorded in it. That is the right
    // neighbourhood for a question about a period, and the wrong answer to a
    // question about a subject: the seeds of "鲸鱼迁徙" and "疫苗冷链" differ, but
    // they fall in the same day bucket, so expanding the bucket made both queries
    // return the same memories. When the query names its subject, the bucket's
    // other memories may join the pulse only if the subject matched there too.
    const queryNamesTerms = Array.from(new Set([
      ...compiledQuery.ir.entities,
      ...compiledQuery.ir.semantics.entityHints,
      ...compiledQuery.ir.mustMatch,
      ...compiledQuery.ir.shouldMatch,
      ...input.query.split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2)
    ])).some((term) => term.trim().length >= 2);
    const temporalNeuronIdsForPulse = queryNamesTerms
      ? input.temporalNeuronIds
      : Array.from(new Set([...input.temporalNeuronIds, ...branchSearch.temporalTraversal.neuronIds]));

    // `branchSearch.neuronIds` is the bucket expansion too, so it carries the same
    // "every memory recorded that day" meaning and is held back the same way.
    const branchNeuronIdsForPulse = queryNamesTerms
      ? branchSearch.denseJointNeuronIds
      : Array.from(new Set([...branchSearch.neuronIds, ...branchSearch.denseJointNeuronIds]));

    const pulse = this.pulseRetrievalEngine.run({
      projectId: input.projectId,
      plan,
      ir: compiledQuery.ir,
      entityIds: compiledQuery.entityResolution.resolved.map((entity) => entity.entityId),
      topologyIds: Array.from(new Set([...input.topologyIds, ...branchNeuronIdsForPulse])),
      branchIds: Array.from(new Set([...input.branchIds, ...branchSearch.denseJointNeuronIds])),
      // The bucket ids are the third way the same expansion travels: the pulse
      // resolves them through the adjacency store into pulse2, which is how a
      // subject query still received "everything recorded that day" after the
      // neuron lists above were held back. Measured before this: disabling the two
      // gates above changed no evaluation outcome at all.
      temporalBucketIds: input.temporalEnabled === false ? [] : Array.from(new Set([...input.temporalBucketIds, ...branchSearch.temporalTraversal.bucketIds])),
      temporalNeuronIds: input.temporalEnabled === false ? [] : temporalNeuronIdsForPulse,
      graphIds: input.graphIds,
      cognitiveGraphIds: input.cognitiveGraphIds,
      entityNeuronIds: Array.from(new Set([...input.entityNeuronIds, ...branchSearch.denseJointNeuronIds]))
    });

    const traversal = this.traversalExecutor.execute({
      temporalSegments: branchSearch.temporalTraversal.segments,
      branchIds: branchSearch.branchIds,
      taskIds: branchSearch.taskIds,
      clusterIds: branchSearch.clusterIds,
      denseJointCount: branchSearch.denseJointNeuronIds.length
    });

    const narrative = this.narrativeRecallAssembler.assemble({
      query: input.query,
      plannerReasons: plan.diagnostics.reasons,
      pulseTrace: pulse.trace,
      temporalLabels: branchSearch.temporalTraversal.labels,
      branchIds: branchSearch.branchIds,
      entityIds: compiledQuery.entityResolution.resolved.map((entity) => entity.entityId),
      denseJointCount: branchSearch.denseJointNeuronIds.length,
      traversalPath: traversal.path,
      traversalSegments: traversal.segments
    });

    return {
      compiledQuery,
      branchSearch,
      pulse,
      narrative,
      runtime: {
        path: traversal.path,
        segments: traversal.segments
      }
    };
  }
}
