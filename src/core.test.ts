import assert from "node:assert/strict";
import test from "node:test";
import {
  appendGeneratedByFooter,
  buildCommitPrompt,
  sanitizeCommitMessage,
  truncateDiff,
} from "./core";
import {
  DEFAULT_CONFIG,
  mergeConfig,
  parseTomlConfig,
} from "./config";

test("sanitizeCommitMessage strips markdown fences and labels", () => {
  const raw = "```text\nCommit message: feat: add codex commit button\n```";

  assert.equal(
    sanitizeCommitMessage(raw),
    "feat: add codex commit button",
  );
});

test("sanitizeCommitMessage preserves a subject and body", () => {
  const raw = "\"fix: handle empty diffs\\n\\nExplain the fallback path.\"";

  assert.equal(
    sanitizeCommitMessage(raw),
    "fix: handle empty diffs\n\nExplain the fallback path.",
  );
});

test("truncateDiff respects utf8 byte limit and records truncation", () => {
  const result = truncateDiff("abc Кириллица def", 8);

  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.diff, "utf8") <= 8);
});

test("buildCommitPrompt asks for only the commit message and includes diff source", () => {
  const prompt = buildCommitPrompt({
    diff: "diff --git a/a.ts b/a.ts",
    diffSource: "staged",
    conventionalCommits: true,
    additionalInstructions: "Prefer imperative mood.",
    truncated: false,
    messageMode: "summary",
    includeBody: "auto",
    language: "auto",
    maxSubjectChars: 72,
  });

  assert.match(prompt, /Return only the commit message/);
  assert.match(prompt, /Diff source: staged/);
  assert.match(prompt, /Prefer imperative mood/);
  assert.match(prompt, /diff --git a\/a\.ts b\/a\.ts/);
});

test("buildCommitPrompt supports expanded mode with body requirements", () => {
  const prompt = buildCommitPrompt({
    diff: "diff --git a/a.ts b/a.ts",
    diffSource: "working tree",
    conventionalCommits: false,
    additionalInstructions: "",
    truncated: false,
    messageMode: "expanded",
    includeBody: "always",
    language: "en",
    maxSubjectChars: 60,
  });

  assert.match(prompt, /Include a body/);
  assert.match(prompt, /Language: en/);
  assert.match(prompt, /60 characters/);
});

test("appendGeneratedByFooter appends configured attribution", () => {
  assert.equal(
    appendGeneratedByFooter(
      "feat: add button",
      true,
      "Generated via Codex Commit Message by {author}",
      "Test User <test@example.com>",
    ),
    "feat: add button\n\nGenerated via Codex Commit Message by Test User <test@example.com>",
  );
});

test("parseTomlConfig reads codex and message settings", () => {
  const config = parseTomlConfig(`
    [codex]
    reasoning_effort = "medium"
    timeout_ms = 90000
    diff_mode = "staged"

    [message]
    mode = "expanded"
    include_body = "always"
    generated_by = true
    generated_by_author = "@vulkanfry"
  `);

  assert.equal(config.codex?.reasoningEffort, "medium");
  assert.equal(config.codex?.timeoutMs, 90000);
  assert.equal(config.codex?.diffMode, "staged");
  assert.equal(config.message?.mode, "expanded");
  assert.equal(config.message?.includeBody, "always");
  assert.equal(config.message?.generatedBy, true);
  assert.equal(config.message?.generatedByAuthor, "@vulkanfry");
});

test("mergeConfig keeps defaults and applies TOML overrides", () => {
  const merged = mergeConfig(DEFAULT_CONFIG, {
    message: {
      mode: "expanded",
      generatedBy: true,
    },
  });

  assert.equal(merged.codex.path, "codex");
  assert.equal(merged.message.mode, "expanded");
  assert.equal(merged.message.generatedBy, true);
  assert.equal(merged.message.maxSubjectChars, 72);
});
