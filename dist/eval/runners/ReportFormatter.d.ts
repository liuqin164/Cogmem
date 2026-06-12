import type { EvalSuiteResult } from './EvalRunner.ts';
export interface ReportWriteResult {
    directory: string;
    jsonPath: string;
    markdownPath: string;
    latestPath: string;
}
export declare class ReportFormatter {
    formatJson(results: EvalSuiteResult[]): string;
    formatMarkdown(results: EvalSuiteResult[]): string;
    writeReports(results: EvalSuiteResult[], rootDir?: string): ReportWriteResult;
}
//# sourceMappingURL=ReportFormatter.d.ts.map