// Renderer memory budget (ticket 246): samples the main window's JS heap and process memory over a run
// and fails when it passes a budget, or when the heap grows by more than a set share across the run.
//
//   bun scripts/renderer-memory-budget.ts --cdp http://127.0.0.1:9333 --seconds 120 --budget-mb 500
//
// The app must run with remote debugging on (the dev stack on DISPLAY :17 uses port 9333). Each sample
// forces a garbage collection first, so the numbers are what the page retains, not what is waiting.
import { createOpenBotLogger } from "@openbot/logging";
import { chromium } from "playwright-core";

const logger = createOpenBotLogger("renderer-memory-budget");

interface Options {
  cdp: string;
  seconds: number;
  everySeconds: number;
  budgetMb: number;
  growthShare: number;
}

function options(argv: readonly string[]): Options {
  const value = (name: string, fallback: string) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
  };
  return {
    cdp: value("cdp", "http://127.0.0.1:9333"),
    seconds: Number(value("seconds", "60")),
    everySeconds: Number(value("every", "10")),
    budgetMb: Number(value("budget-mb", "500")),
    growthShare: Number(value("growth", "0.5")),
  };
}

const MB = 1024 * 1024;

async function main(): Promise<0 | 1> {
  const settings = options(process.argv.slice(2));
  const browser = await chromium.connectOverCDP(settings.cdp);
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => !candidate.url().includes("webrtc") && !candidate.url().includes("island"));
  if (!page) throw new Error("No OpenBot window page on this debugging port.");
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const samples: { at: number; heapMb: number; nodes: number; listeners: number }[] = [];
  const started = Date.now();
  while (Date.now() - started <= settings.seconds * 1000) {
    await session.send("HeapProfiler.collectGarbage");
    const { metrics } = await session.send("Performance.getMetrics");
    const metric = (name: string) => metrics.find((entry) => entry.name === name)?.value ?? 0;
    const sample = {
      at: Math.round((Date.now() - started) / 1000),
      heapMb: Math.round(metric("JSHeapUsedSize") / MB),
      nodes: metric("Nodes"),
      listeners: metric("JSEventListeners"),
    };
    samples.push(sample);
    logger.info("sample", sample);
    await new Promise((resolve) => setTimeout(resolve, settings.everySeconds * 1000));
  }
  await browser.close().catch(() => undefined);
  const first = samples[0]?.heapMb ?? 0;
  const peak = Math.max(...samples.map((sample) => sample.heapMb));
  const last = samples.at(-1)?.heapMb ?? 0;
  const grew = first > 0 ? (last - first) / first : 0;
  logger.info("summary", { firstMb: first, peakMb: peak, lastMb: last, growth: Number(grew.toFixed(2)) });
  if (peak > settings.budgetMb) {
    logger.error(`The renderer heap peaked at ${peak} MB, over the ${settings.budgetMb} MB budget.`);
    return 1;
  }
  if (grew > settings.growthShare) {
    logger.error(`The renderer heap grew by ${Math.round(grew * 100)}% over the run.`);
    return 1;
  }
  return 0;
}

process.exitCode = await main();
