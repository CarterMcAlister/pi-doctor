declare module "sentiment" {
  interface AnalyzeOptions {
    extras?: Record<string, number>;
  }

  interface AnalyzeResult {
    score: number;
    comparative: number;
    positive: string[];
    negative: string[];
  }

  export default class Sentiment {
    analyze(phrase: string, options?: AnalyzeOptions): AnalyzeResult;
  }
}
