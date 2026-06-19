export class BindingDecisionEngine {
    decide(input) {
        if (input.bindingType === 'correction' && input.relatedCount > 0)
            return 'corrects_prior_memory';
        if (input.bindingType === 'correction')
            return 'possible_conflict';
        if (input.relatedCount === 0 || input.supportCount <= 1)
            return 'create_new_cluster';
        if ((input.relatedBindingTypes || []).includes(input.bindingType) || input.supportCount > 1)
            return 'strengthen_existing';
        return 'attach_to_existing';
    }
}
