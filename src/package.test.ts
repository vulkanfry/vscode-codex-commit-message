import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
);

test("VS Code settings expose every TOML config leaf", () => {
  const settings = Object.keys(packageJson.contributes.configuration.properties);

  assert.deepEqual(settings.sort(), [
    "codexCommitMessage.additionalInstructions",
    "codexCommitMessage.codexPath",
    "codexCommitMessage.configPath",
    "codexCommitMessage.conventionalCommits",
    "codexCommitMessage.diffMode",
    "codexCommitMessage.generatedBy",
    "codexCommitMessage.generatedByAuthor",
    "codexCommitMessage.generatedByFormat",
    "codexCommitMessage.ignoreRules",
    "codexCommitMessage.ignoreUserConfig",
    "codexCommitMessage.includeBody",
    "codexCommitMessage.language",
    "codexCommitMessage.maxDiffBytes",
    "codexCommitMessage.maxSubjectChars",
    "codexCommitMessage.messageMode",
    "codexCommitMessage.model",
    "codexCommitMessage.reasoningEffort",
    "codexCommitMessage.timeoutMs",
  ].sort());
});
