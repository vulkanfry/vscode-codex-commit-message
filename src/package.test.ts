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

test("package metadata is ready for marketplace publishing", () => {
  assert.equal(packageJson.publisher, "vulkanfry");
  assert.deepEqual(packageJson.categories, ["SCM Providers", "Other"]);
  assert.equal(packageJson.icon, "images/icon.png");
  assert.deepEqual(packageJson.galleryBanner, {
    color: "#0f141b",
    theme: "dark",
  });
  assert.deepEqual(packageJson.author, {
    name: "Vladimir Sidorenko",
    email: "vulkanfry@lunatic.cat",
    url: "https://github.com/vulkanfry",
  });
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "https://github.com/vulkanfry/vscode-codex-commit-message.git",
  });
  assert.equal(
    packageJson.homepage,
    "https://github.com/vulkanfry/vscode-codex-commit-message#readme",
  );
  assert.equal(
    packageJson.bugs.url,
    "https://github.com/vulkanfry/vscode-codex-commit-message/issues",
  );
  assert.equal(packageJson.pricing, "Free");
});
