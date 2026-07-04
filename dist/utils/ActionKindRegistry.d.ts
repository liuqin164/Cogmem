export interface ActionKindRule {
    kind: string;
    label: string;
    verb: string;
    pattern: RegExp;
}
export declare const ACTION_KIND_RULES: ActionKindRule[];
export declare function inferActionKinds(text: string): string[];
export declare function inferFirstActionKind(text: string): ActionKindRule | undefined;
//# sourceMappingURL=ActionKindRegistry.d.ts.map