export type DiffSource = "staged" | "working tree";

export interface TruncatedDiff {
  diff: string;
  truncated: boolean;
}

export interface CommitPromptInput {
  diff: string;
  diffSource: DiffSource;
  conventionalCommits: boolean;
  additionalInstructions: string;
  truncated: boolean;
  messageMode: "summary" | "expanded";
  includeBody: "auto" | "always" | "never";
  language: string;
  maxSubjectChars: number;
}

export function truncateDiff(diff: string, maxBytes: number): TruncatedDiff {
  const limit = Math.max(0, Math.floor(maxBytes));
  const bytes = Buffer.from(diff, "utf8");

  if (bytes.byteLength <= limit) {
    return { diff, truncated: false };
  }

  for (let end = limit; end >= 0; end -= 1) {
    const sliced = bytes.subarray(0, end).toString("utf8");
    if (Buffer.byteLength(sliced, "utf8") <= limit) {
      return { diff: sliced, truncated: true };
    }
  }

  return { diff: "", truncated: true };
}

export function buildCommitPrompt(input: CommitPromptInput): string {
  const lines = [
    "Generate a Git commit message from the diff below.",
    "Return only the commit message. Do not include Markdown fences, quotes, labels, or explanations.",
    `Use a concise imperative subject line, preferably no more than ${input.maxSubjectChars} characters.`,
    `Diff source: ${input.diffSource}.`,
    `Language: ${input.language}.`,
  ];

  if (input.messageMode === "summary") {
    lines.push("Prefer a single subject line. Add a body only if the diff cannot be represented clearly in one line.");
  } else {
    lines.push("Include a body that summarizes the important changed areas and user-visible impact.");
  }

  if (input.includeBody === "always") {
    lines.push("Include a body after the subject.");
  } else if (input.includeBody === "never") {
    lines.push("Do not include a body; return only the subject.");
  } else {
    lines.push("Add a short body only when it materially improves the commit message.");
  }

  if (input.conventionalCommits) {
    lines.push("Use Conventional Commits when the change clearly maps to a type such as feat, fix, refactor, test, docs, chore, or perf.");
  }

  if (input.truncated) {
    lines.push("The diff was truncated because it was too large; summarize only the visible changes without inventing hidden details.");
  }

  const extra = input.additionalInstructions.trim();
  if (extra) {
    lines.push(`Additional instructions: ${extra}`);
  }

  lines.push("", "<diff>", input.diff.trim(), "</diff>");

  return lines.join("\n");
}

export function sanitizeCommitMessage(output: string): string {
  let message = stripAnsi(output).replace(/\r\n/g, "\n").trim();

  const fenced = message.match(/^```(?:[\w-]+)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) {
    message = fenced[1].trim();
  }

  message = message.replace(/^commit message\s*:\s*/i, "").trim();
  message = message.replace(/^generated commit message\s*:\s*/i, "").trim();

  const quoted = message.match(/^(["'`])([\s\S]*)\1$/);
  if (quoted) {
    message = quoted[2].replace(/\\n/g, "\n").trim();
  }

  return message;
}

export function appendGeneratedByFooter(
  message: string,
  enabled: boolean,
  format: string,
  author: string,
): string {
  const trimmed = message.trim();
  if (!enabled) {
    return trimmed;
  }

  const footer = format.replace(/\{author\}/g, author || "unknown").trim();
  if (!footer) {
    return trimmed;
  }

  return `${trimmed}\n\n${footer}`;
}

function stripAnsi(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );
}
