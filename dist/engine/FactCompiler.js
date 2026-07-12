import { extractApprovedArchiveProject, extractDeviceAliasCandidates, extractDeviceCandidate, extractExplicitNamedEntityCandidate, extractLatestIssueReference, extractNegativePreferenceCue, extractPreference, extractProjectAliasCandidates, extractProjectCandidate, extractRelativeReferences, hasIssueSignal, INTERACTION_EVENT_PREFIX, inferReferenceType, inferIssueValue, isLatestReference, isPreviousReference, isOwnershipSignal, isPurchaseSignal, normalizeLexiconText } from '../lexicon/coreMemoryLexicon.js';
export class FactCompiler {
    factStore;
    entityStore;
    constructor(factStore, entityStore) {
        this.factStore = factStore;
        this.entityStore = entityStore;
    }
    compile(input) {
        const sourceText = input.unit?.semanticText || input.neuron.content;
        const workingText = normalizeLexiconText(sourceText);
        const createdAt = input.neuron.metadata.createdAt;
        const projectId = input.neuron.metadata.projectId;
        const unitId = input.unit?.unitId;
        const entityIds = [];
        const factInputs = [];
        const eventInputs = [];
        const tags = input.neuron.metadata.tags || [];
        const isImportedSummary = tags.includes('reliability:imported_summary')
            || tags.includes('provenance:imported_summary')
            || tags.includes('source_class:memory_index')
            || tags.includes('memory_layer:summary_seed');
        const isSummarySupport = isImportedSummary
            || (tags.includes('source_class:daily_memory') && tags.includes('reliability:self_summary'));
        const isInteractionEventSemantic = [
            INTERACTION_EVENT_PREFIX.approved,
            INTERACTION_EVENT_PREFIX.rejected,
            INTERACTION_EVENT_PREFIX.entitySelection
        ].some((prefix) => sourceText.startsWith(`${prefix}:`));
        const deviceMatch = extractDeviceCandidate(workingText);
        const semanticDevice = input.semanticCompilation?.entities.find((entity) => entity.type === 'device')?.text;
        const purchaseSignal = isPurchaseSignal(workingText)
            || /(?:我)?买了\s+[A-Za-z]/i.test(workingText);
        const ownershipSignal = isOwnershipSignal(workingText)
            || (input.semanticCompilation?.ownershipSignals.length || 0) > 0;
        const explicitNamedDevice = (!deviceMatch && !semanticDevice && (ownershipSignal || purchaseSignal))
            ? extractExplicitNamedEntityCandidate(workingText)
            : null;
        let primaryDeviceEntityId;
        if (!isInteractionEventSemantic && (ownershipSignal || purchaseSignal)) {
            const name = this.normalizeName(deviceMatch || semanticDevice || explicitNamedDevice || 'device');
            const entity = this.entityStore.upsertEntity({
                canonicalName: name,
                type: 'device',
                aliases: Array.from(new Set([
                    deviceMatch,
                    semanticDevice,
                    explicitNamedDevice,
                    ...extractDeviceAliasCandidates(workingText),
                    name
                ].filter((value) => Boolean(value)))),
                createdFrom: input.neuron.id,
                metadata: {
                    projectId,
                    rawMention: sourceText,
                    answerDisplayName: name,
                    ens1Layer: 'canonical_entity_record'
                },
                createdAt,
                instanceMode: purchaseSignal ? 'new_instance' : 'auto'
            });
            entityIds.push(entity.entityId);
            primaryDeviceEntityId = entity.entityId;
            this.entityStore.recordMention({
                entityId: entity.entityId,
                neuronId: input.neuron.id,
                projectId,
                mentionType: 'declared',
                createdAt
            });
            if (ownershipSignal || purchaseSignal || (input.semanticCompilation?.ownershipSignals.length || 0) > 0) {
                factInputs.push({
                    neuronId: input.neuron.id,
                    unitId,
                    subject: 'user',
                    predicateFamily: 'owns',
                    predicateValue: 'has',
                    object: entity.canonicalName,
                    entityId: entity.entityId,
                    validFrom: createdAt,
                    certaintyLevel: 'certain',
                    confidence: 0.9,
                    ...(isSummarySupport ? {
                        confidence: 0.62,
                        certaintyLevel: 'probable'
                    } : {}),
                    status: 'provisional',
                    sourceText,
                    metadata: {
                        fact_origin: isSummarySupport ? 'imported_summary_support_fact' : 'original_compiler_fact',
                        ...(isSummarySupport ? {
                            provenance_tier: 'support',
                            imported_summary_support: true
                        } : {})
                    }
                });
            }
            if (purchaseSignal) {
                factInputs.push({
                    neuronId: input.neuron.id,
                    unitId,
                    subject: 'user',
                    predicateFamily: 'purchased',
                    predicateValue: 'bought',
                    object: entity.canonicalName,
                    entityId: entity.entityId,
                    validFrom: createdAt,
                    certaintyLevel: 'certain',
                    confidence: 0.92,
                    status: 'verified',
                    sourceText,
                    metadata: {
                        fact_origin: 'original_compiler_fact'
                    }
                });
                const previousDeviceReference = input.semanticCompilation?.relativeReferences.find((reference) => isPreviousReference(reference)) || '前一个';
                const previousDevice = this.entityStore.resolveReference(previousDeviceReference, 'device', { projectId });
                if (previousDevice && previousDevice.entityId !== entity.entityId) {
                    this.entityStore.addRelation({
                        sourceEntityId: previousDevice.entityId,
                        targetEntityId: entity.entityId,
                        relationType: 'replaced_by',
                        sourceNeuronId: input.neuron.id,
                        createdAt
                    });
                }
            }
        }
        if (!isInteractionEventSemantic && input.semanticCompilation?.topics.some((topic) => topic.topic === 'connectivity_issue') && primaryDeviceEntityId) {
            this.entityStore.addAttribute({
                entityId: primaryDeviceEntityId,
                attributeKey: 'issue_family',
                attributeValue: 'connectivity_issue',
                sourceNeuronId: input.neuron.id,
                createdAt
            });
        }
        if (!isInteractionEventSemantic && !primaryDeviceEntityId && input.semanticCompilation?.ownershipSignals.length) {
            const semanticEntity = input.semanticCompilation.entities.find((entity) => entity.type === 'device');
            if (semanticEntity) {
                const entity = this.entityStore.upsertEntity({
                    canonicalName: this.normalizeName(semanticEntity.text),
                    type: 'device',
                    aliases: Array.from(new Set([semanticEntity.text, ...extractDeviceAliasCandidates(workingText)])),
                    createdFrom: input.neuron.id,
                    metadata: {
                        projectId,
                        rawMention: sourceText,
                        answerDisplayName: this.normalizeName(semanticEntity.text),
                        ens1Layer: 'canonical_entity_record'
                    },
                    createdAt
                });
                entityIds.push(entity.entityId);
                primaryDeviceEntityId = entity.entityId;
                this.entityStore.recordMention({
                    entityId: entity.entityId,
                    neuronId: input.neuron.id,
                    projectId,
                    mentionType: 'declared',
                    createdAt
                });
            }
        }
        const issueMatches = !isInteractionEventSemantic
            ? this.extractIssueMatches(workingText, input.semanticCompilation?.issueHints || [])
            : [];
        const selfCorrectionArtifact = !isInteractionEventSemantic
            ? this.buildSelfCorrectionArtifact({
                neuron: input.neuron,
                unitId,
                sourceText,
                workingText,
                projectId,
                semanticCompilation: input.semanticCompilation
            })
            : null;
        if (issueMatches.length > 0) {
            const resolvedDevice = primaryDeviceEntityId
                ? this.entityStore.getByEntityId(primaryDeviceEntityId)
                : this.resolveImplicitEntity(workingText, 'device', projectId);
            for (const issueMatch of issueMatches) {
                const issueMetadata = this.buildIssueMetadata(issueMatch.issue, issueMatch.issue, sourceText, {
                    issueFamily: issueMatch.issueFamily,
                    projectId,
                    ...this.buildContinuityMetadata({
                        issue: issueMatch.issue,
                        sourceText,
                        projectId,
                        createdAt,
                        entity: resolvedDevice || undefined
                    }),
                    ...this.buildWriteTimeBindingMetadata({
                        sourceText: workingText,
                        type: 'device',
                        entity: resolvedDevice || undefined,
                        projectId
                    })
                });
                factInputs.push({
                    neuronId: input.neuron.id,
                    unitId,
                    subject: 'device',
                    predicateFamily: 'has_issue',
                    predicateValue: this.normalizeIssueValue(issueMatch.issue),
                    object: resolvedDevice?.canonicalName || this.normalizeName(issueMatch.reference),
                    entityId: resolvedDevice?.entityId,
                    validFrom: createdAt,
                    certaintyLevel: 'certain',
                    confidence: 0.88,
                    ...(isSummarySupport ? {
                        confidence: 0.58,
                        certaintyLevel: 'possible'
                    } : {}),
                    status: 'provisional',
                    sourceText,
                    metadata: {
                        ...issueMetadata,
                        fact_origin: isSummarySupport ? 'imported_summary_support_fact' : 'original_compiler_fact',
                        ...(isSummarySupport ? {
                            provenance_tier: 'support',
                            imported_summary_support: true,
                            episodic_lane: 'support_only'
                        } : {})
                    }
                });
            }
            if (resolvedDevice) {
                entityIds.push(resolvedDevice.entityId);
                this.entityStore.recordMention({
                    entityId: resolvedDevice.entityId,
                    neuronId: input.neuron.id,
                    projectId,
                    mentionType: 'attributed',
                    createdAt
                });
                this.entityStore.addAttribute({
                    entityId: resolvedDevice.entityId,
                    attributeKey: 'issue',
                    attributeValue: issueMatches
                        .map((issueMatch) => `${this.normalizeName(issueMatch.reference)}:${this.normalizeIssueValue(issueMatch.issue)}`)
                        .join('|'),
                    sourceNeuronId: input.neuron.id,
                    createdAt
                });
                const pendingReference = this.extractPendingEntityReference(workingText, input.semanticCompilation?.relativeReferences || []);
                if (pendingReference && /之前那个|前一个|上一个/.test(pendingReference)) {
                    this.entityStore.registerPendingResolution({
                        referenceText: pendingReference,
                        entityType: 'device',
                        contextNeuronId: input.neuron.id,
                        createdAt
                    });
                }
            }
            else {
                const pendingReference = this.extractPendingEntityReference(workingText, input.semanticCompilation?.relativeReferences || []);
                if (pendingReference) {
                    this.entityStore.registerPendingResolution({
                        referenceText: pendingReference,
                        entityType: 'device',
                        contextNeuronId: input.neuron.id,
                        createdAt
                    });
                }
            }
        }
        else if (input.semanticCompilation?.issueHints.length && primaryDeviceEntityId) {
            const resolvedDevice = this.entityStore.getByEntityId(primaryDeviceEntityId);
            for (const issueHint of input.semanticCompilation.issueHints.slice(0, 2)) {
                const issueMetadata = this.buildIssueMetadata(issueHint, issueHint, sourceText);
                factInputs.push({
                    neuronId: input.neuron.id,
                    unitId,
                    subject: 'device',
                    predicateFamily: 'has_issue',
                    predicateValue: this.normalizeName(issueHint),
                    object: resolvedDevice?.canonicalName || 'device',
                    entityId: resolvedDevice?.entityId,
                    validFrom: createdAt,
                    certaintyLevel: 'probable',
                    confidence: 0.78,
                    ...(isSummarySupport ? {
                        confidence: 0.52,
                        certaintyLevel: 'possible'
                    } : {}),
                    status: 'provisional',
                    sourceText,
                    metadata: {
                        ...issueMetadata,
                        fact_origin: isSummarySupport ? 'imported_summary_support_fact' : 'original_compiler_fact',
                        ...(isSummarySupport ? {
                            provenance_tier: 'support',
                            imported_summary_support: true,
                            episodic_lane: 'support_only'
                        } : {})
                    }
                });
            }
        }
        if (selfCorrectionArtifact) {
            factInputs.push(selfCorrectionArtifact);
        }
        const projectCandidate = !isInteractionEventSemantic ? extractProjectCandidate(workingText) : undefined;
        const projectMatch = projectCandidate ? [projectCandidate, projectCandidate] : null;
        if (projectMatch) {
            const projectName = this.normalizeName(projectMatch[1]);
            const projectAliases = Array.from(new Set([
                projectMatch[1],
                ...extractProjectAliasCandidates(workingText)
            ].filter(Boolean)));
            const entity = this.entityStore.upsertEntity({
                canonicalName: projectName,
                type: 'project',
                aliases: projectAliases,
                createdFrom: input.neuron.id,
                metadata: {
                    projectId: input.neuron.metadata.projectId,
                    projectLocalInternalSlug: input.neuron.metadata.projectId,
                    rawMention: sourceText,
                    answerDisplayName: projectName,
                    ens1ProjectLocalNaming: {
                        internalSlug: input.neuron.metadata.projectId,
                        canonicalProjectName: projectName,
                        answerSurfaceProjectName: projectName
                    }
                },
                createdAt
            });
            entityIds.push(entity.entityId);
            this.entityStore.recordMention({
                entityId: entity.entityId,
                neuronId: input.neuron.id,
                projectId: input.neuron.metadata.projectId,
                mentionType: 'declared',
                createdAt
            });
            factInputs.push({
                neuronId: input.neuron.id,
                unitId,
                subject: 'user',
                predicateFamily: 'worked_on',
                predicateValue: 'worked_on',
                object: projectName,
                entityId: entity.entityId,
                validFrom: createdAt,
                certaintyLevel: 'certain',
                confidence: 0.86,
                ...(isSummarySupport ? {
                    confidence: 0.6,
                    certaintyLevel: 'probable'
                } : {}),
                status: 'provisional',
                sourceText,
                metadata: {
                    fact_origin: isSummarySupport ? 'imported_summary_support_fact' : 'original_compiler_fact',
                    ...(isSummarySupport ? {
                        provenance_tier: 'support',
                        imported_summary_support: true
                    } : {})
                }
            });
        }
        else if (input.semanticCompilation?.projectLinks.length) {
            for (const projectLink of input.semanticCompilation.projectLinks.slice(0, 2)) {
                if (this.isRelativeProjectSurface(projectLink))
                    continue;
                const projectAliases = Array.from(new Set([
                    projectLink,
                    ...extractProjectAliasCandidates(workingText)
                ].filter(Boolean)));
                const entity = this.entityStore.upsertEntity({
                    canonicalName: this.normalizeName(projectLink),
                    type: 'project',
                    aliases: projectAliases,
                    createdFrom: input.neuron.id,
                    metadata: {
                        projectId,
                        projectLocalInternalSlug: projectId,
                        rawMention: sourceText,
                        answerDisplayName: this.normalizeName(projectLink),
                        ens1ProjectLocalNaming: {
                            internalSlug: projectId,
                            canonicalProjectName: this.normalizeName(projectLink),
                            answerSurfaceProjectName: this.normalizeName(projectLink)
                        }
                    },
                    createdAt
                });
                entityIds.push(entity.entityId);
                this.entityStore.recordMention({
                    entityId: entity.entityId,
                    neuronId: input.neuron.id,
                    projectId,
                    mentionType: 'declared',
                    createdAt
                });
            }
        }
        const projectReference = !isInteractionEventSemantic
            ? extractRelativeReferences(workingText).find((reference) => /项目|project/i.test(reference))
            : undefined;
        if (projectReference) {
            const entity = this.resolveImplicitEntity(projectReference, 'project', projectId);
            if (entity) {
                entityIds.push(entity.entityId);
                this.entityStore.recordMention({
                    entityId: entity.entityId,
                    neuronId: input.neuron.id,
                    projectId,
                    mentionType: 'referenced',
                    createdAt
                });
            }
            this.entityStore.registerPendingResolution({
                referenceText: projectReference,
                entityType: 'project',
                contextNeuronId: input.neuron.id,
                createdAt
            });
        }
        const latestPreference = !isInteractionEventSemantic
            ? (extractPreference(workingText) || extractNegativePreferenceCue(workingText))
            : null;
        if (latestPreference?.kind === 'like') {
            factInputs.push({
                neuronId: input.neuron.id,
                unitId,
                subject: 'user',
                predicateFamily: 'likes',
                predicateValue: 'like',
                object: this.normalizeName(latestPreference.target),
                validFrom: createdAt,
                certaintyLevel: 'certain',
                confidence: 0.84,
                status: 'provisional',
                sourceText,
                metadata: {
                    fact_origin: 'original_compiler_fact'
                }
            });
        }
        if (latestPreference?.kind === 'dislike') {
            factInputs.push({
                neuronId: input.neuron.id,
                unitId,
                subject: 'user',
                predicateFamily: 'dislikes',
                predicateValue: 'dislike',
                object: this.normalizeName(latestPreference.target),
                validFrom: createdAt,
                certaintyLevel: 'certain',
                confidence: 0.84,
                status: 'provisional',
                sourceText,
                metadata: {
                    fact_origin: 'original_compiler_fact'
                }
            });
        }
        if (sourceText.startsWith(`${INTERACTION_EVENT_PREFIX.approved}:`)) {
            const target = sourceText.replace(new RegExp(`^${INTERACTION_EVENT_PREFIX.approved}:\\s*`, 'i'), '');
            const archiveProject = extractApprovedArchiveProject(target);
            eventInputs.push({
                neuronId: input.neuron.id,
                unitId,
                eventType: 'approved',
                actor: 'user',
                target,
                payload: {
                    semanticText: sourceText,
                    action: archiveProject ? 'archive' : 'approve',
                    project: archiveProject || undefined
                },
                validFrom: createdAt,
                confidence: 0.93,
                status: 'verified'
            });
        }
        if (sourceText.startsWith(`${INTERACTION_EVENT_PREFIX.rejected}:`)) {
            const target = sourceText.replace(new RegExp(`^${INTERACTION_EVENT_PREFIX.rejected}:\\s*`, 'i'), '');
            eventInputs.push({
                neuronId: input.neuron.id,
                unitId,
                eventType: 'rejected',
                actor: 'user',
                target,
                payload: {
                    semanticText: sourceText,
                    action: 'reject'
                },
                validFrom: createdAt,
                confidence: 0.93,
                status: 'verified'
            });
        }
        const facts = this.factStore.insertFacts(factInputs);
        const events = this.factStore.insertEvents(eventInputs);
        return { facts, events, entityIds: Array.from(new Set(entityIds)) };
    }
    normalizeName(value) {
        return value.trim().replace(/\s+/g, ' ');
    }
    extractIssueMatches(text, issueHints) {
        const matches = new Map();
        const normalizedHints = issueHints.filter(Boolean);
        for (const issueHint of normalizedHints) {
            const issue = this.extractIssuePhrase(issueHint);
            if (!issue)
                continue;
            const reference = extractDeviceCandidate(issueHint) || extractRelativeReferences(issueHint)[0] || 'device';
            matches.set(`${reference}|${this.normalizeIssueValue(issue)}`, {
                reference,
                issue,
                issueFamily: this.inferIssueFamily(issue)
            });
        }
        if (matches.size === 0) {
            const latest = extractLatestIssueReference(text);
            if (latest) {
                matches.set(`${latest.reference}|${this.normalizeIssueValue(latest.issue)}`, {
                    ...latest,
                    issueFamily: this.inferIssueFamily(latest.issue)
                });
            }
        }
        return Array.from(matches.values());
    }
    normalizeIssueValue(value) {
        return inferIssueValue(value) || this.normalizeName(value);
    }
    buildIssueMetadata(issue, sourcePhrase, sourceText, extra = {}) {
        const normalizedIssueValue = this.normalizeIssueValue(issue);
        return {
            normalizedIssueValue,
            issueOriginalWording: issue,
            issueSourcePhrase: sourcePhrase,
            ...(extra.issueFamily ? { issueFamily: extra.issueFamily } : { issueFamily: this.inferIssueFamily(issue) }),
            ...extra,
            sourceTextSnapshot: sourceText
        };
    }
    buildContinuityMetadata(input) {
        const continuityFamilies = new Set();
        const normalizedIssueValue = this.normalizeIssueValue(input.issue);
        const recentEntityFacts = input.entity
            ? this.factStore.listFactsByEntityIds([input.entity.entityId], {
                predicateFamilies: ['has_issue'],
                limit: 16
            }).filter((fact) => fact.validFrom < input.createdAt)
            : [];
        const matchingIssueHistory = recentEntityFacts.filter((fact) => this.normalizeIssueValue(String(fact.metadata?.normalizedIssueValue || fact.predicateValue || '')) === normalizedIssueValue);
        const sameProjectEntityFacts = recentEntityFacts.filter((fact) => fact.metadata?.projectId === input.projectId);
        const siblingIssues = Array.from(new Set(sameProjectEntityFacts
            .map((fact) => this.normalizeIssueValue(String(fact.metadata?.normalizedIssueValue || fact.predicateValue || '')))
            .filter((value) => Boolean(value) && value !== normalizedIssueValue)));
        const projectSurfaceName = input.projectId
            ? this.resolveContinuityProjectSurfaceName(input.sourceText, input.projectId, input.createdAt)
            : undefined;
        const followUpCue = /(follow(?:ing)? up|还是|依旧|仍然|又|still|again)/i.test(input.sourceText);
        const handoffCue = /(handoff|handover|交接|接手|下一轮|next session)/i.test(input.sourceText);
        if (followUpCue || matchingIssueHistory.length > 0) {
            continuityFamilies.add('repeated_follow_up_continuity');
        }
        if (handoffCue) {
            continuityFamilies.add('verified_session_handoff_continuity');
        }
        if (input.projectId && input.entity && siblingIssues.length > 0) {
            continuityFamilies.add('stable_same_project_sibling_continuity');
        }
        if (input.projectId && input.entity) {
            continuityFamilies.add('narrow_device_project_continuity');
        }
        const crossDayAnchor = matchingIssueHistory.find((fact) => input.createdAt - fact.validFrom >= 24 * 60 * 60 * 1000);
        if (crossDayAnchor) {
            continuityFamilies.add('repeated_same_entity_cross_day_continuity');
        }
        return {
            continuityFamilies: Array.from(continuityFamilies),
            continuityAnswerEligible: continuityFamilies.size > 0,
            continuityRepeatCount: matchingIssueHistory.length + 1,
            continuitySiblingIssueCount: siblingIssues.length,
            continuitySiblingIssues: siblingIssues,
            continuityCrossDayRepeat: Boolean(crossDayAnchor),
            continuityCrossDayGapDays: crossDayAnchor
                ? Math.max(1, Math.round((input.createdAt - crossDayAnchor.validFrom) / (24 * 60 * 60 * 1000)))
                : undefined,
            continuityHandoffOpen: handoffCue,
            continuityProjectScope: input.projectId,
            continuityProjectSurfaceName: projectSurfaceName,
            continuityResolvedEntityName: input.entity?.canonicalName,
            continuityAnswerSurfaceEntityName: input.entity?.canonicalName,
            ens1RawMention: input.sourceText,
            ens1CanonicalEntityName: input.entity?.canonicalName,
            ens1AnswerSurfaceDisplayName: input.entity?.canonicalName,
            ens1ProjectLocalInternalSlug: input.projectId,
            ens1ProjectCanonicalName: projectSurfaceName,
            ens1ProjectAnswerSurfaceName: projectSurfaceName,
            ens1IdentityFields: ['entityId', 'ens1CanonicalEntityName', 'ens1ProjectCanonicalName'],
            ens1DisplayFields: ['ens1AnswerSurfaceDisplayName', 'ens1ProjectAnswerSurfaceName']
        };
    }
    buildWriteTimeBindingMetadata(input) {
        const relativeReference = extractRelativeReferences(input.sourceText)[0];
        if (!relativeReference || !input.entity)
            return {};
        const candidates = this.entityStore.listReferenceCandidatesWithRelativeSupport(relativeReference, input.type, {
            projectId: input.projectId
        });
        const top = candidates[0];
        if (!top || top.entity.entityId !== input.entity.entityId)
            return {};
        return {
            writeTimeRelativeBindingApplied: true,
            writeTimeRelativeBindingReference: relativeReference,
            writeTimeRelativeBindingScore: top.score,
            writeTimeRelativeBindingEntityId: top.entity.entityId,
            writeTimeRelativeBindingEntityName: top.entity.canonicalName,
            writeTimeRelativeBindingCanonicalSurfaceName: top.entity.canonicalName,
            writeTimeRelativeBindingCanonicalIdentityName: top.entity.canonicalName,
            writeTimeRelativeBindingDisplayName: top.entity.canonicalName,
            ens1RelativeReferenceSurface: relativeReference,
            ens1RelativeReferenceLandingLayer: 'canonical_entity_record',
            ens1RelativeReferenceLandingStatus: 'resolved_narrow_safe',
            ens1RelativeReferenceLandingEntityId: top.entity.entityId,
            ens1RelativeReferenceLandingCanonicalName: top.entity.canonicalName
        };
    }
    resolveContinuityProjectSurfaceName(sourceText, projectId, createdAt) {
        const explicit = extractProjectCandidate(sourceText);
        if (explicit)
            return this.normalizeName(explicit);
        const timeline = this.entityStore.getEntityTimeline({
            type: 'project',
            projectId,
            limit: 6
        });
        const matched = timeline.find((item) => item.createdAt <= createdAt);
        return matched?.canonicalName;
    }
    extractIssuePhrase(segment) {
        const normalized = this.normalizeName(segment);
        if (/配对(?:也)?很慢/.test(normalized))
            return '配对慢';
        if (/电流声/.test(normalized))
            return '电流声';
        const qualifier = normalized.includes('左耳') ? '左耳' : normalized.includes('右耳') ? '右耳' : '';
        const inferred = inferIssueValue(normalized);
        if (!inferred)
            return null;
        return qualifier && !inferred.startsWith(qualifier) ? `${qualifier}${inferred}` : inferred;
    }
    inferIssueFamily(issue) {
        if (/断连/.test(issue))
            return 'connectivity_issue';
        if (/(杂音|电流声)/.test(issue))
            return 'sound_issue';
        if (/(卡顿|配对慢)/.test(issue))
            return 'performance_issue';
        return 'generic_issue';
    }
    buildSelfCorrectionArtifact(input) {
        if (!this.isSelfCorrectionSurface(input.workingText))
            return null;
        const correctionTo = this.extractCorrectionSide(input.workingText);
        if (!correctionTo)
            return null;
        const correctionFrom = this.extractNegatedCorrectionSide(input.workingText, correctionTo);
        const resolvedDevice = this.resolveImplicitEntity('它', 'device', input.projectId)
            || this.entityStore.findLatestByType('device');
        const recentIssue = resolvedDevice
            ? this.factStore.listFactsByEntityIds([resolvedDevice.entityId], {
                predicateFamilies: ['has_issue'],
                limit: 8
            }).find((fact) => fact.validFrom <= input.neuron.metadata.createdAt)
            : this.factStore.listFactsByTimeRange(0, input.neuron.metadata.createdAt + 1, {
                limit: 12
            }).find((fact) => fact.predicateFamily === 'has_issue' && this.factMatchesCorrectionSide(fact, correctionTo))
                || this.factStore.listFactsByTimeRange(0, input.neuron.metadata.createdAt + 1, {
                    limit: 12
                }).find((fact) => fact.predicateFamily === 'has_issue');
        const issueStem = recentIssue
            ? (inferIssueValue(`${recentIssue.metadata?.issueOriginalWording || recentIssue.predicateValue || recentIssue.sourceText}`) || '异常')
            : '异常';
        const correctionIssue = `${correctionTo}${issueStem}`;
        return {
            neuronId: input.neuron.id,
            unitId: input.unitId,
            subject: 'device',
            predicateFamily: 'issue_correction',
            predicateValue: correctionTo,
            object: resolvedDevice?.canonicalName || 'device',
            entityId: resolvedDevice?.entityId,
            validFrom: input.neuron.metadata.createdAt,
            certaintyLevel: 'probable',
            confidence: recentIssue ? 0.82 : 0.74,
            status: 'provisional',
            sourceText: input.sourceText,
            metadata: this.buildIssueMetadata(correctionIssue, input.sourceText, input.sourceText, {
                issueFamily: this.inferIssueFamily(correctionIssue),
                correctionArtifact: true,
                correctionKind: 'self_correction',
                correctionStage: 'write_time',
                correctionTo,
                correctionFrom,
                correctionBasisFactId: recentIssue?.factId,
                correctedIssueValue: correctionIssue
            })
        };
    }
    isSelfCorrectionSurface(text) {
        const hasEarSurface = /(左耳|右耳)/.test(text) || /\b(left ear|right ear)\b/i.test(text);
        if (!hasEarSurface)
            return false;
        return /(不对|不是|更正|改口)/.test(text)
            || /\b(no|actually|correction|not)\b/i.test(text);
    }
    extractCorrectionSide(text) {
        if (/右耳/.test(text))
            return '右耳';
        if (/左耳/.test(text))
            return '左耳';
        if (/right ear/i.test(text))
            return '右耳';
        if (/left ear/i.test(text))
            return '左耳';
        return null;
    }
    extractNegatedCorrectionSide(text, correctionTo) {
        if (/不是左耳|not left ear/i.test(text) && correctionTo !== '左耳')
            return '左耳';
        if (/不是右耳|not right ear/i.test(text) && correctionTo !== '右耳')
            return '右耳';
        return undefined;
    }
    factMatchesCorrectionSide(fact, correctionTo) {
        const haystack = `${fact.predicateValue || ''} ${fact.metadata?.issueOriginalWording || ''}`;
        return haystack.includes(correctionTo);
    }
    extractPendingEntityReference(sourceText, relativeReferences) {
        const normalizedReferences = relativeReferences.length > 0 ? relativeReferences : extractRelativeReferences(sourceText);
        const explicit = normalizedReferences.find(Boolean);
        if (explicit)
            return explicit;
        return null;
    }
    isRelativeProjectSurface(text) {
        const normalized = normalizeLexiconText(text).trim();
        return /^(这个|那个|前一个|上一个|新的|新|旧的|旧).{0,4}项目$/i.test(normalized)
            || /^(this|that|the previous|previous|the new|new|old)\s+project$/i.test(normalized);
    }
    resolveImplicitEntity(sourceText, type, projectId) {
        const relativeReferences = extractRelativeReferences(sourceText);
        if (relativeReferences.length > 0) {
            const matched = this.pickSpecificRelativeReference(relativeReferences, type)
                || (type === 'project' ? '这个项目' : '它');
            const hasTypedRelativeSurface = inferReferenceType(matched, matched) === type;
            const hasOrderedInstanceSignal = isLatestReference(matched) || isPreviousReference(matched);
            if (this.isWeakRelativeReferenceSurface(matched, type) && !hasTypedRelativeSurface && !hasOrderedInstanceSignal) {
                return null;
            }
            const safelyResolved = this.resolveRelativeEntitySafely(matched, type, projectId);
            if (safelyResolved)
                return safelyResolved;
            if (this.isWeakRelativeReferenceSurface(matched, type) && !hasOrderedInstanceSignal) {
                return null;
            }
            if (type === 'device' && relativeReferences.some((reference) => isPreviousReference(reference))) {
                return null;
            }
            return this.entityStore.resolveReference(matched, type, { projectId });
        }
        const direct = this.entityStore.resolveReference(sourceText, type, {
            projectId
        });
        if (direct)
            return direct;
        if (type === 'device' && hasIssueSignal(sourceText)) {
            return this.entityStore.resolveReference('它', 'device', { projectId });
        }
        return null;
    }
    resolveRelativeEntitySafely(reference, type, projectId) {
        const candidates = this.entityStore.listReferenceCandidatesWithRelativeSupport(reference, type, {
            projectId
        });
        const best = candidates[0];
        const runnerUp = candidates[1];
        if (!best)
            return null;
        const minScore = isPreviousReference(reference) ? 0.68 : 0.7;
        const margin = runnerUp ? best.score - runnerUp.score : best.score;
        if (best.score < minScore || margin < 0.22) {
            return null;
        }
        return {
            entityId: best.entity.entityId,
            canonicalName: best.entity.canonicalName
        };
    }
    isWeakRelativeReferenceSurface(reference, type) {
        const normalized = normalizeLexiconText(reference).trim().toLowerCase();
        if (type === 'device') {
            return /^(?:之前那个|前一个|上一个|新的那个|那个|这个|the previous one|previous one|the new one|new one|that one|this one)$/i.test(normalized);
        }
        if (type === 'project') {
            return /^(?:那个项目|这个项目|前一个项目|上一个项目|新的项目|the previous project|previous project|the new project|new project|that project|this project)$/i.test(normalized);
        }
        return false;
    }
    pickSpecificRelativeReference(references, type) {
        const typed = references
            .filter((reference) => inferReferenceType(reference, reference) === type)
            .sort((a, b) => b.length - a.length);
        if (typed.length > 0)
            return typed[0] || null;
        const sorted = [...references].sort((a, b) => b.length - a.length);
        return sorted[0] || null;
    }
}
