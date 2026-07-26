import type { AlertDefinition, Condition, Selector, Term } from "../../src/observability/alerts";

/**
 * Enough of Prometheus to evaluate the rules of `src/observability/alerts.ts`
 * against a real exposition. A range is two scrapes: `increase` is the difference
 * between them and `rate` is that difference over the interval, which is exactly
 * what Prometheus computes from two samples. Nothing here interprets PromQL text;
 * the rules file and this evaluator are rendered and driven from one definition, so
 * a rule cannot pass here while saying something else in the file.
 */

export type Sample = Readonly<{
  metric: string;
  labels: Readonly<Record<string, string>>;
  value: number;
}>;

export function parseExposition(text: string): readonly Sample[] {
  const samples: Sample[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") {
      continue;
    }
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(.+)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, metric = "", , labelText = "", raw = ""] = match;
    const labels: Record<string, string> = {};
    for (const pair of labelText.match(/[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\]|\\.)*"/g) ?? []) {
      const [name = "", ...rest] = pair.split("=");
      labels[name] = rest.join("=").slice(1, -1).replace(/\\"/g, '"');
    }
    samples.push({ metric, labels, value: Number(raw) });
  }
  return samples;
}

function matches(sample: Sample, selector: Selector): boolean {
  if (sample.metric !== selector.metric) {
    return false;
  }
  for (const [name, value] of Object.entries(selector.labels ?? {})) {
    if (sample.labels[name] !== value) {
      return false;
    }
  }
  for (const [name, pattern] of Object.entries(selector.patterns ?? {})) {
    if (!new RegExp(`^(?:${pattern})$`).test(sample.labels[name] ?? "")) {
      return false;
    }
  }
  return true;
}

function total(samples: readonly Sample[], selector: Selector): number {
  return samples
    .filter((sample) => matches(sample, selector))
    .reduce((sum, sample) => sum + sample.value, 0);
}

function highest(samples: readonly Sample[], selector: Selector): number {
  const values = samples.filter((sample) => matches(sample, selector)).map((s) => s.value);
  return values.length === 0 ? Number.NaN : Math.max(...values);
}

export type Range = Readonly<{
  /** The scrape at the start of the window. */
  before: readonly Sample[];
  /** The scrape at the end of it, which is also the instant value. */
  after: readonly Sample[];
  nowSeconds: number;
}>;

function valueOf(term: Term, range: Range): number {
  switch (term.kind) {
    case "value":
      return total(range.after, term.selector);
    case "increase":
      return total(range.after, term.selector) - total(range.before, term.selector);
    case "share": {
      const part = total(range.after, term.part) - total(range.before, term.part);
      const whole = total(range.after, term.whole) - total(range.before, term.whole);
      return whole === 0 ? Number.NaN : part / whole;
    }
    case "age":
      return range.nowSeconds - highest(range.after, term.selector);
  }
}

function holds(condition: Condition, range: Range): boolean {
  const value = valueOf(condition.term, range);
  switch (condition.comparison) {
    case ">":
      return value > condition.threshold;
    case ">=":
      return value >= condition.threshold;
    case "<":
      return value < condition.threshold;
    case "<=":
      return value <= condition.threshold;
    case "==":
      return value === condition.threshold;
  }
}

/** Whether every part of the rule holds, which is when Prometheus would fire it. */
export function fires(definition: AlertDefinition, range: Range): boolean {
  return definition.all.every((condition) => holds(condition, range));
}

/**
 * One counter's value from an exposition, matched by name and by the labels given.
 * A series that is absent reads as zero, which is what a counter that has never
 * been incremented means.
 */
export function sampleValue(
  text: string,
  metric: string,
  labels: Readonly<Record<string, string>> = {},
): number {
  return total(parseExposition(text), { metric, labels });
}
