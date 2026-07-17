export class UniverseNavigator {
    queryCompiler;
    retrievalPlanner;
    temporalBranchSearch;
    pulseRetrievalEngine;
    narrativeRecallAssembler;
    traversalExecutor;
    constructor(queryCompiler, retrievalPlanner, temporalBranchSearch, pulseRetrievalEngine, narrativeRecallAssembler, traversalExecutor) {
        this.queryCompiler = queryCompiler;
        this.retrievalPlanner = retrievalPlanner;
        this.temporalBranchSearch = temporalBranchSearch;
        this.pulseRetrievalEngine = pulseRetrievalEngine;
        this.narrativeRecallAssembler = narrativeRecallAssembler;
        this.traversalExecutor = traversalExecutor;
    }
    navigate(input) {
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
            terms: Array.from(new Set([
                ...compiledQuery.ir.entities,
                ...compiledQuery.ir.semantics.entityHints,
                ...compiledQuery.ir.mustMatch,
                ...compiledQuery.ir.shouldMatch
            ]))
        });
        const pulse = this.pulseRetrievalEngine.run({
            projectId: input.projectId,
            plan,
            ir: compiledQuery.ir,
            entityIds: compiledQuery.entityResolution.resolved.map((entity) => entity.entityId),
            topologyIds: Array.from(new Set([...input.topologyIds, ...branchSearch.neuronIds, ...branchSearch.denseJointNeuronIds])),
            branchIds: Array.from(new Set([...input.branchIds, ...branchSearch.neuronIds])),
            temporalBucketIds: input.temporalEnabled === false ? [] : Array.from(new Set([...input.temporalBucketIds, ...branchSearch.temporalTraversal.bucketIds])),
            temporalNeuronIds: input.temporalEnabled === false ? [] : Array.from(new Set([...input.temporalNeuronIds, ...branchSearch.temporalTraversal.neuronIds])),
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
