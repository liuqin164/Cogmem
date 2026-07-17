import { randomUUID } from 'crypto';
export class CognitiveGraphCompiler {
    store;
    entityStore;
    constructor(store, entityStore) {
        this.store = store;
        this.entityStore = entityStore;
    }
    compile(input) {
        const { neuron, consolidation, topology } = input;
        const createdAt = neuron.metadata.createdAt;
        const projectId = neuron.metadata.projectId;
        const seedNodeIds = [];
        let edgeCount = 0;
        const neuronNode = this.store.upsertNode({
            nodeId: `cgnode-${randomUUID()}`,
            nodeType: 'neuron',
            nodeKey: `neuron:${neuron.id}`,
            title: neuron.metadata.aaak_summary || neuron.content.slice(0, 120),
            projectId,
            sourceNeuronId: neuron.id,
            metadata: {
                type: neuron.metadata.type,
                status: neuron.metadata.status || 'active'
            },
            createdAt
        });
        seedNodeIds.push(neuronNode.nodeId);
        for (const bucket of topology.timeBuckets) {
            const bucketNode = this.store.upsertNode({
                nodeId: `cgnode-${randomUUID()}`,
                nodeType: 'time_bucket',
                nodeKey: `time_bucket:${bucket.bucketId}`,
                title: bucket.label,
                projectId,
                sourceNeuronId: neuron.id,
                metadata: { bucketType: bucket.bucketType },
                createdAt
            });
            this.store.linkNodes({
                sourceNodeId: neuronNode.nodeId,
                targetNodeId: bucketNode.nodeId,
                edgeType: 'occurred_in_time_bucket',
                projectId,
                createdAt
            });
            seedNodeIds.push(bucketNode.nodeId);
            edgeCount += 1;
        }
        if (consolidation.interactionUnit) {
            const unitNode = this.store.upsertNode({
                nodeId: `cgnode-${randomUUID()}`,
                nodeType: 'unit',
                nodeKey: `unit:${consolidation.interactionUnit.unitId}`,
                title: consolidation.interactionUnit.semanticText,
                projectId,
                sourceNeuronId: neuron.id,
                metadata: { type: consolidation.interactionUnit.type },
                createdAt
            });
            this.store.linkNodes({
                sourceNodeId: unitNode.nodeId,
                targetNodeId: neuronNode.nodeId,
                edgeType: 'summarizes',
                projectId,
                createdAt
            });
            seedNodeIds.push(unitNode.nodeId);
            edgeCount += 1;
        }
        for (const belief of consolidation.beliefs) {
            edgeCount += this.attachBeliefNode(neuronNode.nodeId, belief, projectId, createdAt, seedNodeIds);
        }
        for (const fact of consolidation.compiledFacts) {
            const factNode = this.store.upsertNode({
                nodeId: `cgnode-${randomUUID()}`,
                nodeType: 'fact',
                nodeKey: `fact:${fact.factId}`,
                title: `${fact.subject} ${fact.predicateFamily} ${fact.object || fact.predicateValue || ''}`.trim(),
                projectId,
                sourceNeuronId: neuron.id,
                metadata: {
                    predicateFamily: fact.predicateFamily,
                    predicateValue: fact.predicateValue,
                    object: fact.object
                },
                createdAt
            });
            this.store.linkNodes({
                sourceNodeId: factNode.nodeId,
                targetNodeId: neuronNode.nodeId,
                edgeType: 'references_fact',
                projectId,
                createdAt
            });
            seedNodeIds.push(factNode.nodeId);
            edgeCount += 1;
            if (fact.entityId) {
                const entity = this.entityStore.getByEntityId(fact.entityId);
                if (entity) {
                    const entityNode = this.store.upsertNode({
                        nodeId: `cgnode-${randomUUID()}`,
                        nodeType: 'entity',
                        nodeKey: `entity:${entity.entityId}`,
                        title: entity.canonicalName,
                        projectId,
                        sourceNeuronId: neuron.id,
                        metadata: {
                            type: entity.type,
                            aliases: entity.aliases
                        },
                        createdAt
                    });
                    this.store.linkNodes({
                        sourceNodeId: factNode.nodeId,
                        targetNodeId: entityNode.nodeId,
                        edgeType: 'mentions_entity',
                        projectId,
                        createdAt
                    });
                    seedNodeIds.push(entityNode.nodeId);
                    edgeCount += 1;
                }
            }
        }
        for (const event of consolidation.compiledEvents) {
            const eventNode = this.store.upsertNode({
                nodeId: `cgnode-${randomUUID()}`,
                nodeType: 'compiled_event',
                nodeKey: `compiled_event:${event.eventId}`,
                title: `${event.eventType}:${event.target || event.actor || 'event'}`,
                projectId,
                sourceNeuronId: neuron.id,
                metadata: {
                    eventType: event.eventType,
                    actor: event.actor,
                    target: event.target
                },
                createdAt
            });
            this.store.linkNodes({
                sourceNodeId: eventNode.nodeId,
                targetNodeId: neuronNode.nodeId,
                edgeType: 'references_event',
                projectId,
                createdAt
            });
            seedNodeIds.push(eventNode.nodeId);
            edgeCount += 1;
        }
        for (const branchId of topology.branchIds) {
            const branchNode = this.store.upsertNode({
                nodeId: `cgnode-${randomUUID()}`,
                nodeType: 'project_branch',
                nodeKey: `project_branch:${branchId}`,
                title: branchId,
                projectId,
                sourceNeuronId: neuron.id,
                metadata: { branchId },
                createdAt
            });
            this.store.linkNodes({
                sourceNodeId: neuronNode.nodeId,
                targetNodeId: branchNode.nodeId,
                edgeType: 'belongs_to_project_branch',
                projectId,
                createdAt
            });
            seedNodeIds.push(branchNode.nodeId);
            edgeCount += 1;
        }
        for (const taskId of topology.taskIds) {
            const taskNode = this.store.upsertNode({
                nodeId: `cgnode-${randomUUID()}`,
                nodeType: 'task_branch',
                nodeKey: `task_branch:${taskId}`,
                title: taskId,
                projectId,
                sourceNeuronId: neuron.id,
                metadata: { taskId },
                createdAt
            });
            this.store.linkNodes({
                sourceNodeId: neuronNode.nodeId,
                targetNodeId: taskNode.nodeId,
                edgeType: 'belongs_to_task',
                projectId,
                createdAt
            });
            seedNodeIds.push(taskNode.nodeId);
            edgeCount += 1;
        }
        for (const clusterId of topology.clusterIds) {
            const clusterNode = this.store.upsertNode({
                nodeId: `cgnode-${randomUUID()}`,
                nodeType: 'event_cluster',
                nodeKey: `event_cluster:${clusterId}`,
                title: clusterId,
                projectId,
                sourceNeuronId: neuron.id,
                metadata: { clusterId },
                createdAt
            });
            this.store.linkNodes({
                sourceNodeId: neuronNode.nodeId,
                targetNodeId: clusterNode.nodeId,
                edgeType: 'belongs_to_event_cluster',
                projectId,
                createdAt
            });
            seedNodeIds.push(clusterNode.nodeId);
            edgeCount += 1;
        }
        return {
            seedNodeIds: Array.from(new Set(seedNodeIds)),
            edgeCount
        };
    }
    rebuildTimeBuckets(input) {
        for (const neuron of input.neurons) {
            const neuronKey = `neuron:${neuron.id}`;
            const neuronNode = this.store.findNode(input.projectId, 'neuron', neuronKey) ?? this.store.upsertNode({
                nodeId: `cgnode-${randomUUID()}`,
                nodeType: 'neuron',
                nodeKey: neuronKey,
                title: neuron.title,
                projectId: input.projectId,
                sourceNeuronId: neuron.id,
                metadata: { status: 'active' },
                createdAt: neuron.createdAt,
            });
            for (const bucket of input.bucketsByNeuronId.get(neuron.id) ?? []) {
                const bucketNode = this.store.upsertNode({
                    nodeId: `cgnode-${randomUUID()}`,
                    nodeType: 'time_bucket',
                    nodeKey: `time_bucket:${bucket.bucketId}`,
                    title: bucket.label,
                    projectId: input.projectId,
                    sourceNeuronId: neuron.id,
                    metadata: { bucketType: bucket.bucketType, timeZone: bucket.timeZone },
                    createdAt: neuron.createdAt,
                });
                this.store.linkNodes({
                    sourceNodeId: neuronNode.nodeId,
                    targetNodeId: bucketNode.nodeId,
                    edgeType: 'occurred_in_time_bucket',
                    projectId: input.projectId,
                    createdAt: neuron.createdAt,
                });
            }
        }
    }
    attachBeliefNode(neuronNodeId, belief, projectId, createdAt, seedNodeIds) {
        const beliefNode = this.store.upsertNode({
            nodeId: `cgnode-${randomUUID()}`,
            nodeType: 'belief',
            nodeKey: `belief:${belief.id}`,
            title: `${belief.subject} ${belief.predicate}=${belief.objectValue.raw}`,
            projectId,
            sourceNeuronId: belief.sourceNeuronId,
            metadata: {
                canonicalKey: belief.canonicalKey,
                status: belief.status
            },
            createdAt
        });
        this.store.linkNodes({
            sourceNodeId: beliefNode.nodeId,
            targetNodeId: neuronNodeId,
            edgeType: 'supports_belief',
            projectId,
            createdAt
        });
        seedNodeIds.push(beliefNode.nodeId);
        return 1;
    }
}
