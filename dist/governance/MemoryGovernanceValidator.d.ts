import type { MemoryEvidenceRole, MemoryGovernancePlan, MemoryGovernanceValidationResult } from './MemoryGovernancePlan.js';
export interface GovernanceEvidenceRecord {
    eventId: string;
    projectId?: string;
    role?: MemoryEvidenceRole | string;
}
export type GovernanceEvidenceLookup = (eventId: string) => GovernanceEvidenceRecord | undefined;
export declare class MemoryGovernanceValidator {
    private readonly findEvidence;
    constructor(findEvidence: GovernanceEvidenceLookup);
    validate(plan: MemoryGovernancePlan): MemoryGovernanceValidationResult;
}
//# sourceMappingURL=MemoryGovernanceValidator.d.ts.map