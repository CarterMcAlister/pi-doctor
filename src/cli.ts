#!/usr/bin/env bun
import { Command } from "commander";
import { loadModel, saveModel, checkSession } from "./model";
import { generateReport, formatReportJson } from "./reporter";
import { generateAgentsRules } from "./suggestions";
import { resolveSessionFile } from "./indexer";
import { buildSessionTimeline, renderAnalyzeOutput, renderCheckOutput } from "./viz";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const createSpinner = () => {
  let frameIndex = 0;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let currentMessage = "";

  const render = (): void => {
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    process.stderr.write(`\r${DIM}${frame} ${currentMessage}${RESET}\u001b[K`);
    frameIndex++;
  };

  return {
    start(message: string): void {
      currentMessage = message;
      render();
      intervalId = setInterval(render, 80);
    },
    update(message: string): void {
      currentMessage = message;
    },
    stop(): void {
      if (intervalId) clearInterval(intervalId);
      process.stderr.write("\r\u001b[K");
    }
  };
};

const program = new Command();

program
  .name("pi-doctor")
  .description("Diagnose Pi agent sessions. Analyzes transcript history for behavioral anti-patterns and generates AGENTS.md guidance.")
  .version("0.1.0")
  .argument("[session]", "Session ID or .jsonl path to check a specific Pi session")
  .option("-p, --project <path>", "Filter to a specific project path / cwd")
  .option("--rules", "Output generated AGENTS.md rules")
  .option("--save", "Save analysis model to .pi-doctor/")
  .option("--json", "Output as JSON")
  .option("-d, --dir <path>", "Project root for .pi-doctor/")
  .action(async (sessionArg: string | undefined, options: { project?: string; rules?: boolean; save?: boolean; json?: boolean; dir?: string }) => {
    if (sessionArg) {
      const spinner = createSpinner();
      spinner.start("Checking Pi session…");

      const resolved = await resolveSessionFile(sessionArg, options.project);
      if (!resolved) {
        spinner.stop();
        console.error(`Could not find session: ${sessionArg}`);
        process.exit(1);
      }

      const savedModel = loadModel(options.dir);
      const result = await checkSession(resolved.filePath, resolved.sessionId, savedModel);
      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const { turns, healthPercentage, summary } = await buildSessionTimeline(resolved.filePath);
      spinner.stop();
      console.log(renderCheckOutput(result.sessionId, turns, healthPercentage, summary, result.activeSignals, result.guidance));
      return;
    }

    const spinner = createSpinner();
    spinner.start("Scanning Pi sessions…");
    const report = await generateReport(options.project, (current: number, total: number, projectName: string) => {
      spinner.update(`Analyzing ${projectName} (${current}/${total})`);
    });
    spinner.stop();

    if (options.save) {
      const modelDir = saveModel(report, options.dir);
      console.log(`Model saved to ${modelDir}/ (${report.totalSessions} sessions, ${report.totalProjects} projects)`);
      console.log("");
    }

    if (options.rules) {
      const rulesText = generateAgentsRules(report.projects, report.totalSessions);
      console.log(rulesText || "No rules to generate — sessions look healthy.");
      return;
    }

    if (options.json) {
      console.log(formatReportJson(report));
      return;
    }

    console.log(await renderAnalyzeOutput(report));
  });

program.parse();
