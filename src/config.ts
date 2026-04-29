export type DiffMode = "stagedOrWorkingTree" | "staged" | "workingTree";
export type ReasoningEffort = "" | "low" | "medium" | "high" | "xhigh";
export type MessageMode = "summary" | "expanded";
export type IncludeBody = "auto" | "always" | "never";

export interface CodexSettings {
  path: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  timeoutMs: number;
  maxDiffBytes: number;
  diffMode: DiffMode;
  ignoreRules: boolean;
  ignoreUserConfig: boolean;
  additionalInstructions: string;
}

export interface MessageSettings {
  mode: MessageMode;
  conventionalCommits: boolean;
  language: string;
  includeBody: IncludeBody;
  maxSubjectChars: number;
  generatedBy: boolean;
  generatedByAuthor: string;
  generatedByFormat: string;
}

export interface CodexCommitConfig {
  codex: CodexSettings;
  message: MessageSettings;
}

export type PartialCodexCommitConfig = {
  codex?: Partial<CodexSettings>;
  message?: Partial<MessageSettings>;
};

export const DEFAULT_CONFIG: CodexCommitConfig = {
  codex: {
    path: "codex",
    model: "",
    reasoningEffort: "low",
    timeoutMs: 120_000,
    maxDiffBytes: 200_000,
    diffMode: "stagedOrWorkingTree",
    ignoreRules: true,
    ignoreUserConfig: false,
    additionalInstructions: "",
  },
  message: {
    mode: "summary",
    conventionalCommits: true,
    language: "auto",
    includeBody: "auto",
    maxSubjectChars: 72,
    generatedBy: false,
    generatedByAuthor: "git_author",
    generatedByFormat: "Generated via Codex Commit Message by {author}",
  },
};

export const DEFAULT_CONFIG_TOML = `# Codex Commit Message configuration

[codex]
path = "codex"
model = ""
reasoning_effort = "low"
timeout_ms = 120000
max_diff_bytes = 200000
diff_mode = "staged_or_working_tree"
ignore_rules = true
ignore_user_config = false
additional_instructions = ""

[message]
# summary: prefer one concise subject, body only when useful.
# expanded: ask for subject plus explanatory body.
mode = "summary"
conventional_commits = true
language = "auto"
include_body = "auto"
max_subject_chars = 72

# Adds a footer to the generated message after Codex returns it.
generated_by = false
generated_by_author = "git_author"
generated_by_format = "Generated via Codex Commit Message by {author}"
`;

export function mergeConfig(
  base: CodexCommitConfig,
  override: PartialCodexCommitConfig,
): CodexCommitConfig {
  return {
    codex: {
      ...base.codex,
      ...compactObject(override.codex),
    },
    message: {
      ...base.message,
      ...compactObject(override.message),
    },
  };
}

export function parseTomlConfig(content: string): PartialCodexCommitConfig {
  const config: PartialCodexCommitConfig = {};
  let section = "";

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }

    applyValue(config, section, assignment[1], parseTomlValue(assignment[2].trim()));
  }

  return config;
}

function applyValue(
  config: PartialCodexCommitConfig,
  section: string,
  key: string,
  value: string | number | boolean,
): void {
  if (section === "codex") {
    config.codex = config.codex ?? {};
    applyCodexValue(config.codex, key, value);
    return;
  }

  if (section === "message") {
    config.message = config.message ?? {};
    applyMessageValue(config.message, key, value);
  }
}

function applyCodexValue(
  target: Partial<CodexSettings>,
  key: string,
  value: string | number | boolean,
): void {
  switch (key) {
    case "path":
      if (typeof value === "string") target.path = value;
      break;
    case "model":
      if (typeof value === "string") target.model = value;
      break;
    case "reasoning_effort":
      if (typeof value === "string") target.reasoningEffort = normalizeReasoningEffort(value);
      break;
    case "timeout_ms":
      if (typeof value === "number") target.timeoutMs = value;
      break;
    case "max_diff_bytes":
      if (typeof value === "number") target.maxDiffBytes = value;
      break;
    case "diff_mode":
      if (typeof value === "string") target.diffMode = normalizeDiffMode(value);
      break;
    case "ignore_rules":
      if (typeof value === "boolean") target.ignoreRules = value;
      break;
    case "ignore_user_config":
      if (typeof value === "boolean") target.ignoreUserConfig = value;
      break;
    case "additional_instructions":
      if (typeof value === "string") target.additionalInstructions = value;
      break;
  }
}

function applyMessageValue(
  target: Partial<MessageSettings>,
  key: string,
  value: string | number | boolean,
): void {
  switch (key) {
    case "mode":
      if (typeof value === "string") target.mode = normalizeMessageMode(value);
      break;
    case "conventional_commits":
      if (typeof value === "boolean") target.conventionalCommits = value;
      break;
    case "language":
      if (typeof value === "string") target.language = value;
      break;
    case "include_body":
      if (typeof value === "string") target.includeBody = normalizeIncludeBody(value);
      break;
    case "max_subject_chars":
      if (typeof value === "number") target.maxSubjectChars = value;
      break;
    case "generated_by":
      if (typeof value === "boolean") target.generatedBy = value;
      break;
    case "generated_by_author":
      if (typeof value === "string") target.generatedByAuthor = value;
      break;
    case "generated_by_format":
      if (typeof value === "string") target.generatedByFormat = value;
      break;
  }
}

function parseTomlValue(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;

  const quoted = value.match(/^"([\s\S]*)"$/);
  if (quoted) {
    return quoted[1]
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
  }

  const number = Number(value);
  if (Number.isFinite(number)) {
    return number;
  }

  return value;
}

function stripComment(line: string): string {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (char === "#" && !inString) {
      return line.slice(0, index);
    }
  }

  return line;
}

function normalizeReasoningEffort(value: string): ReasoningEffort {
  return ["", "low", "medium", "high", "xhigh"].includes(value)
    ? (value as ReasoningEffort)
    : DEFAULT_CONFIG.codex.reasoningEffort;
}

function normalizeDiffMode(value: string): DiffMode {
  if (value === "staged_or_working_tree" || value === "stagedOrWorkingTree") {
    return "stagedOrWorkingTree";
  }
  if (value === "staged" || value === "workingTree" || value === "working_tree") {
    return value === "working_tree" ? "workingTree" : (value as DiffMode);
  }
  return DEFAULT_CONFIG.codex.diffMode;
}

function normalizeMessageMode(value: string): MessageMode {
  return value === "expanded" ? "expanded" : "summary";
}

function normalizeIncludeBody(value: string): IncludeBody {
  return value === "always" || value === "never" ? value : "auto";
}

function compactObject<T extends object>(value: Partial<T> | undefined): Partial<T> {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
