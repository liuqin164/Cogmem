import { randomUUID } from 'crypto';
import { localDateFor, localDateRange, nextCivilDate } from '../utils/LocalDateContext.js';
import { resolveTimeZone } from '../utils/LocalDateContext.js';
import { timeBucketId } from '../topology/TimeBucketIdentity.js';
export class TopologyCompiler {
    store;
    constructor(store) {
        this.store = store;
    }
    compile(input) {
        const { neuron, consolidation } = input;
        const projectId = neuron.metadata.projectId;
        const createdAt = neuron.metadata.createdAt;
        const ref = {
            neuronId: neuron.id,
            unitId: consolidation.interactionUnit?.unitId,
            createdAt
        };
        const timeBuckets = input.temporalEnabled === false ? [] : this.attachTimeBuckets(createdAt, projectId, ref, input.timeZone);
        const branchIds = projectId ? this.attachProjectBranches(projectId, neuron, consolidation, ref) : [];
        const taskIds = this.attachTaskBranches(projectId, neuron, consolidation, ref);
        const clusterIds = this.attachEventClusters(projectId, neuron, consolidation, ref);
        return { timeBuckets, branchIds, taskIds, clusterIds };
    }
    rebuildTimeBuckets(neurons, timeZone) {
        const buckets = new Map();
        const byId = new Map(neurons.map((neuron) => [neuron.id, neuron]));
        for (const [neuronId, planned] of this.planTimeBuckets(neurons, timeZone)) {
            const neuron = byId.get(neuronId);
            for (const bucket of planned) {
                this.store.upsertTimeBucket(bucket);
                this.store.attachToTimeBucket(bucket.bucketId, { neuronId, projectId: neuron.projectId, createdAt: neuron.createdAt });
                buckets.set(bucket.bucketId, bucket);
            }
        }
        return [...buckets.values()];
    }
    planTimeBuckets(neurons, timeZone) {
        const planned = new Map();
        for (const neuron of neurons) {
            planned.set(neuron.id, [
                this.buildBucket('day', neuron.createdAt, neuron.projectId, timeZone),
                this.buildBucket('week', neuron.createdAt, neuron.projectId, timeZone),
                this.buildBucket('month', neuron.createdAt, neuron.projectId, timeZone),
            ]);
        }
        return planned;
    }
    attachTimeBuckets(createdAt, projectId, ref, timeZone) {
        const buckets = [
            this.buildBucket('day', createdAt, projectId, timeZone),
            this.buildBucket('week', createdAt, projectId, timeZone),
            this.buildBucket('month', createdAt, projectId, timeZone)
        ];
        for (const bucket of buckets) {
            this.store.upsertTimeBucket(bucket);
            this.store.attachToTimeBucket(bucket.bucketId, {
                ...ref,
                projectId
            });
        }
        return buckets;
    }
    attachProjectBranches(projectId, neuron, consolidation, ref) {
        const createdAt = ref.createdAt;
        const branchIds = [];
        const root = this.store.upsertProjectBranch({
            branchId: `pbranch-${randomUUID()}`,
            projectId,
            branchKey: `project:${projectId}`,
            branchKind: 'project_root',
            title: projectId,
            createdAt
        });
        this.store.attachToBranch(root.branchId, ref);
        branchIds.push(root.branchId);
        if (consolidation.interactionUnit) {
            const interactionBranch = this.store.upsertProjectBranch({
                branchId: `pbranch-${randomUUID()}`,
                projectId,
                branchKey: `interaction:${consolidation.interactionUnit.unitId}`,
                branchKind: 'interaction',
                title: consolidation.interactionUnit.semanticText,
                createdAt
            });
            this.store.linkBranches(root.branchId, interactionBranch.branchId, 'contains', createdAt);
            this.store.attachToBranch(interactionBranch.branchId, ref);
            branchIds.push(interactionBranch.branchId);
        }
        for (const belief of consolidation.beliefs) {
            const branch = this.store.upsertProjectBranch({
                branchId: `pbranch-${randomUUID()}`,
                projectId,
                branchKey: `belief:${belief.canonicalKey}`,
                branchKind: 'belief',
                title: `${belief.subject} ${belief.predicate}=${belief.objectValue.raw}`,
                createdAt
            });
            this.store.linkBranches(root.branchId, branch.branchId, 'contains', createdAt);
            this.store.attachToBranch(branch.branchId, {
                ...ref,
                beliefId: belief.id
            });
            branchIds.push(branch.branchId);
        }
        for (const fact of consolidation.compiledFacts) {
            const branch = this.store.upsertProjectBranch({
                branchId: `pbranch-${randomUUID()}`,
                projectId,
                branchKey: `fact:${fact.subject}:${fact.predicateFamily}:${fact.object || fact.predicateValue || 'unknown'}`,
                branchKind: 'fact',
                title: `${fact.subject} ${fact.predicateFamily} ${fact.object || fact.predicateValue || ''}`.trim(),
                createdAt
            });
            this.store.linkBranches(root.branchId, branch.branchId, 'contains', createdAt);
            this.store.attachToBranch(branch.branchId, {
                ...ref,
                factId: fact.factId
            });
            branchIds.push(branch.branchId);
        }
        for (const event of consolidation.compiledEvents) {
            const branch = this.store.upsertProjectBranch({
                branchId: `pbranch-${randomUUID()}`,
                projectId,
                branchKey: `event:${event.eventType}:${event.target || event.actor || 'unknown'}`,
                branchKind: 'event',
                title: `${event.eventType}:${event.target || event.actor || 'event'}`,
                createdAt
            });
            this.store.linkBranches(root.branchId, branch.branchId, 'contains', createdAt);
            this.store.attachToBranch(branch.branchId, {
                ...ref,
                eventId: event.eventId
            });
            branchIds.push(branch.branchId);
        }
        if (this.looksLikeTaskCarrier(neuron.content, consolidation.beliefs)) {
            const taskBranch = this.store.upsertProjectBranch({
                branchId: `pbranch-${randomUUID()}`,
                projectId,
                branchKey: `task:${this.normalizeKey(neuron.content).slice(0, 72)}`,
                branchKind: 'task',
                title: neuron.content.slice(0, 96),
                createdAt
            });
            this.store.linkBranches(root.branchId, taskBranch.branchId, 'contains', createdAt);
            this.store.attachToBranch(taskBranch.branchId, ref);
            branchIds.push(taskBranch.branchId);
        }
        return branchIds;
    }
    attachTaskBranches(projectId, neuron, consolidation, ref) {
        const taskIds = [];
        const createdAt = ref.createdAt;
        const taskTitles = new Set();
        for (const fact of consolidation.compiledFacts) {
            if (fact.predicateFamily === 'worked_on' && fact.object)
                taskTitles.add(fact.object);
            if (fact.predicateFamily === 'has_issue' && fact.object)
                taskTitles.add(`issue:${fact.object}`);
        }
        for (const belief of consolidation.beliefs) {
            if (belief.predicate.startsWith('workflow.') || belief.predicate.startsWith('decision.')) {
                taskTitles.add(belief.predicate);
            }
        }
        if (consolidation.interactionUnit?.type === 'proposal') {
            taskTitles.add(consolidation.interactionUnit.semanticText);
        }
        for (const title of taskTitles) {
            const task = this.store.upsertTaskBranch({
                taskId: `task-${randomUUID()}`,
                projectId,
                taskKey: this.normalizeKey(title),
                title,
                status: 'derived',
                createdAt
            });
            this.store.attachToTask(task.taskId, ref);
            for (const fact of consolidation.compiledFacts) {
                this.store.attachToTask(task.taskId, { factId: fact.factId, createdAt });
            }
            for (const belief of consolidation.beliefs) {
                this.store.attachToTask(task.taskId, { beliefId: belief.id, createdAt });
            }
            taskIds.push(task.taskId);
        }
        return taskIds;
    }
    attachEventClusters(projectId, neuron, consolidation, ref) {
        const clusterIds = [];
        const createdAt = ref.createdAt;
        for (const event of consolidation.compiledEvents) {
            const clusterType = this.toClusterType(event.eventType);
            const cluster = this.store.upsertEventCluster({
                clusterId: `cluster-${randomUUID()}`,
                projectId,
                clusterKey: `${clusterType}:${this.normalizeKey(event.target || event.actor || event.eventType)}`,
                clusterType,
                title: event.target || event.actor || event.eventType,
                createdAt
            });
            this.store.attachToEventCluster(cluster.clusterId, {
                ...ref,
                eventId: event.eventId
            });
            clusterIds.push(cluster.clusterId);
        }
        for (const fact of consolidation.compiledFacts) {
            if (fact.predicateFamily !== 'has_issue' && fact.predicateFamily !== 'worked_on')
                continue;
            const clusterType = fact.predicateFamily === 'has_issue' ? 'issue' : 'project';
            const cluster = this.store.upsertEventCluster({
                clusterId: `cluster-${randomUUID()}`,
                projectId,
                clusterKey: `${clusterType}:${this.normalizeKey(fact.object || fact.predicateValue || fact.subject)}`,
                clusterType,
                title: fact.object || fact.predicateValue || fact.subject,
                createdAt
            });
            this.store.attachToEventCluster(cluster.clusterId, {
                ...ref,
                factId: fact.factId
            });
            clusterIds.push(cluster.clusterId);
        }
        for (const belief of consolidation.beliefs) {
            if (!belief.predicate.startsWith('decision.'))
                continue;
            const cluster = this.store.upsertEventCluster({
                clusterId: `cluster-${randomUUID()}`,
                projectId,
                clusterKey: `fact:${this.normalizeKey(belief.predicate)}`,
                clusterType: 'fact',
                title: belief.predicate,
                createdAt
            });
            this.store.attachToEventCluster(cluster.clusterId, {
                ...ref,
                beliefId: belief.id
            });
            clusterIds.push(cluster.clusterId);
        }
        if (clusterIds.length === 0 && this.looksLikeTaskCarrier(neuron.content, consolidation.beliefs)) {
            const cluster = this.store.upsertEventCluster({
                clusterId: `cluster-${randomUUID()}`,
                projectId,
                clusterKey: `generic:${this.normalizeKey(neuron.content).slice(0, 72)}`,
                clusterType: 'generic',
                title: neuron.content.slice(0, 96),
                createdAt
            });
            this.store.attachToEventCluster(cluster.clusterId, ref);
            clusterIds.push(cluster.clusterId);
        }
        return clusterIds;
    }
    buildBucket(bucketType, timestamp, projectId, timeZone) {
        const resolvedTimeZone = resolveTimeZone(timeZone);
        const [year, month, day] = localDateFor(timestamp, resolvedTimeZone).split('-').map(Number);
        const civilDate = (offsetDays) => nextCivilDate(year, month, day, offsetDays, resolvedTimeZone);
        let start;
        let end;
        let label;
        if (bucketType === 'day') {
            const next = civilDate(1);
            ({ from: start, to: end } = localDateRange(year, month, day, ...next, resolvedTimeZone));
            label = localDateFor(start, resolvedTimeZone);
        }
        else if (bucketType === 'week') {
            const weekday = new Intl.DateTimeFormat('en-US', { timeZone: resolvedTimeZone, weekday: 'short' }).format(new Date(timestamp));
            const mondayOffset = { Mon: 0, Tue: -1, Wed: -2, Thu: -3, Fri: -4, Sat: -5, Sun: -6 }[weekday] ?? 0;
            const monday = civilDate(mondayOffset);
            const nextMonday = nextCivilDate(monday[0], monday[1], monday[2], 7, resolvedTimeZone);
            ({ from: start, to: end } = localDateRange(monday[0], monday[1], monday[2], ...nextMonday, resolvedTimeZone));
            label = `week:${localDateFor(start, resolvedTimeZone)}`;
        }
        else {
            const nextMonth = month === 12 ? [year + 1, 1] : [year, month + 1];
            ({ from: start, to: end } = localDateRange(year, month, 1, nextMonth[0], nextMonth[1], 1, resolvedTimeZone));
            label = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
        }
        return {
            bucketId: timeBucketId({ projectId, timeZone: resolvedTimeZone, bucketType, bucketStart: start, bucketEnd: end }),
            projectId,
            timeZone: resolvedTimeZone,
            bucketType,
            bucketStart: start,
            bucketEnd: end,
            label
        };
    }
    looksLikeTaskCarrier(content, beliefs) {
        return /项目|project|修复|fix|实现|implement|计划|plan|任务|task|workflow|步骤|step/i.test(content)
            || beliefs.some((belief) => belief.predicate.startsWith('workflow.') || belief.predicate.startsWith('decision.'));
    }
    toClusterType(eventType) {
        if (/approved/i.test(eventType))
            return 'approval';
        if (/rejected/i.test(eventType))
            return 'rejection';
        return 'generic';
    }
    normalizeKey(value) {
        return value.trim().toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '');
    }
}
