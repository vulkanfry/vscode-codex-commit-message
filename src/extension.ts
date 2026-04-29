import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as vscode from "vscode";
import {
  CodexCommitConfig,
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_TOML,
  DiffMode,
  mergeConfig,
  parseTomlConfig,
  PartialCodexCommitConfig,
} from "./config";
import {
  appendGeneratedByFooter,
  buildCommitPrompt,
  DiffSource,
  sanitizeCommitMessage,
  truncateDiff,
} from "./core";

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: {
    value: string;
  };
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

const OUTPUT_LIMIT_BYTES = 1024 * 1024;

let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const generateCommand = vscode.commands.registerCommand(
    "codexCommitMessage.generate",
    async (rootUri?: vscode.Uri) => {
      outputChannel = outputChannel ?? vscode.window.createOutputChannel("Codex Commit Message");

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.SourceControl },
        async () => generateCommitMessage(rootUri),
      );
    },
  );
  const configCommand = vscode.commands.registerCommand(
    "codexCommitMessage.openConfig",
    openConfig,
  );

  context.subscriptions.push(generateCommand, configCommand);
}

export function deactivate(): void {
  outputChannel?.dispose();
}

async function generateCommitMessage(rootUri?: vscode.Uri): Promise<void> {
  const repository = await resolveRepository(rootUri);
  const cwd = repository?.rootUri.fsPath ?? rootUri?.fsPath ?? (await pickWorkspaceFolder());

  if (!cwd) {
    vscode.window.showWarningMessage("Open a Git repository before generating a Codex commit message.");
    return;
  }

  try {
    const settings = await readEffectiveConfig(cwd);
    const diff = await readDiff(cwd, settings.codex.diffMode, settings.codex.timeoutMs);
    if (!diff.diff.trim()) {
      vscode.window.showWarningMessage("No staged or working-tree changes found for Codex commit message generation.");
      return;
    }

    const truncated = truncateDiff(diff.diff, settings.codex.maxDiffBytes);
    const prompt = buildCommitPrompt({
      diff: truncated.diff,
      diffSource: diff.source,
      conventionalCommits: settings.message.conventionalCommits,
      additionalInstructions: settings.codex.additionalInstructions,
      truncated: truncated.truncated,
      messageMode: settings.message.mode,
      includeBody: settings.message.includeBody,
      language: settings.message.language,
      maxSubjectChars: settings.message.maxSubjectChars,
    });

    const rawMessage = await runCodex(cwd, prompt, settings);
    const message = appendGeneratedByFooter(
      sanitizeCommitMessage(rawMessage),
      settings.message.generatedBy,
      settings.message.generatedByFormat,
      await resolveGeneratedByAuthor(cwd, settings),
    );

    if (!message) {
      throw new Error("Codex CLI returned an empty commit message.");
    }

    if (repository) {
      repository.inputBox.value = message;
    } else {
      vscode.scm.inputBox.value = message;
    }

    vscode.window.setStatusBarMessage("Codex commit message generated", 5000);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(details);
    const action = await vscode.window.showErrorMessage(
      `Codex commit message failed: ${details}`,
      "Show Logs",
    );
    if (action === "Show Logs") {
      outputChannel?.show();
    }
  }
}

async function openConfig(): Promise<void> {
  const config = vscode.workspace.getConfiguration("codexCommitMessage");
  const configured = config.get("configPath", "").trim();
  const configPath = configured ? expandHome(configured) : userConfigPath();

  await mkdir(dirname(configPath), { recursive: true });
  if (!(await fileExists(configPath))) {
    await writeFile(configPath, DEFAULT_CONFIG_TOML, "utf8");
  }

  const document = await vscode.workspace.openTextDocument(configPath);
  await vscode.window.showTextDocument(document);
}

async function readEffectiveConfig(cwd: string): Promise<CodexCommitConfig> {
  let config = mergeConfig(DEFAULT_CONFIG, readVsCodeFallbackConfig());
  const configured = vscode.workspace.getConfiguration("codexCommitMessage").get("configPath", "").trim();
  const configPaths = configured
    ? [expandHome(configured)]
    : [userConfigPath(), join(cwd, ".codex-commit-message.toml")];

  for (const configPath of configPaths) {
    const content = await readOptionalFile(configPath);
    if (content) {
      config = mergeConfig(config, parseTomlConfig(content));
    }
  }

  return normalizeConfig(config);
}

function readVsCodeFallbackConfig(): PartialCodexCommitConfig {
  const config = vscode.workspace.getConfiguration("codexCommitMessage");
  return {
    codex: {
      path: config.get("codexPath", DEFAULT_CONFIG.codex.path),
      model: config.get("model", DEFAULT_CONFIG.codex.model),
      reasoningEffort: config.get("reasoningEffort", DEFAULT_CONFIG.codex.reasoningEffort),
      timeoutMs: config.get("timeoutMs", DEFAULT_CONFIG.codex.timeoutMs),
      maxDiffBytes: config.get("maxDiffBytes", DEFAULT_CONFIG.codex.maxDiffBytes),
      diffMode: config.get("diffMode", DEFAULT_CONFIG.codex.diffMode),
      ignoreRules: config.get("ignoreRules", DEFAULT_CONFIG.codex.ignoreRules),
      additionalInstructions: config.get("additionalInstructions", DEFAULT_CONFIG.codex.additionalInstructions),
    },
    message: {
      conventionalCommits: config.get("conventionalCommits", DEFAULT_CONFIG.message.conventionalCommits),
    },
  };
}

function normalizeConfig(config: CodexCommitConfig): CodexCommitConfig {
  return {
    codex: {
      ...config.codex,
      path: config.codex.path.trim() || DEFAULT_CONFIG.codex.path,
      model: config.codex.model.trim(),
      timeoutMs: Math.max(10_000, config.codex.timeoutMs),
      maxDiffBytes: Math.max(1_000, config.codex.maxDiffBytes),
    },
    message: {
      ...config.message,
      language: config.message.language.trim() || DEFAULT_CONFIG.message.language,
      maxSubjectChars: Math.max(20, config.message.maxSubjectChars),
      generatedByAuthor: config.message.generatedByAuthor.trim() || DEFAULT_CONFIG.message.generatedByAuthor,
      generatedByFormat: config.message.generatedByFormat.trim() || DEFAULT_CONFIG.message.generatedByFormat,
    },
  };
}

async function resolveRepository(rootUri?: vscode.Uri): Promise<GitRepository | undefined> {
  const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git");
  const git = gitExtension ? await gitExtension.activate() : undefined;
  const repositories = git?.getAPI(1).repositories ?? [];

  if (rootUri) {
    const target = rootUri.toString();
    const found = repositories.find((repo) => repo.rootUri.toString() === target);
    if (found) {
      return found;
    }
  }

  if (repositories.length === 1) {
    return repositories[0];
  }

  if (repositories.length > 1) {
    const picked = await vscode.window.showQuickPick(
      repositories.map((repo) => ({
        label: vscode.workspace.asRelativePath(repo.rootUri),
        description: repo.rootUri.fsPath,
        repository: repo,
      })),
      { placeHolder: "Select the Git repository for Codex commit message generation" },
    );
    return picked?.repository;
  }

  return undefined;
}

async function pickWorkspaceFolder(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return undefined;
  }

  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  const picked = await vscode.window.showWorkspaceFolderPick({
    placeHolder: "Select the workspace folder for Codex commit message generation",
  });
  return picked?.uri.fsPath;
}

async function readDiff(
  cwd: string,
  mode: DiffMode,
  timeoutMs: number,
): Promise<{ diff: string; source: DiffSource }> {
  if (mode !== "workingTree") {
    const staged = await runProcess("git", ["diff", "--cached", "--no-ext-diff", "--no-color"], {
      cwd,
      timeoutMs,
    });
    if (staged.stdout.trim() || mode === "staged") {
      return { diff: staged.stdout, source: "staged" };
    }
  }

  const working = await runProcess("git", ["diff", "--no-ext-diff", "--no-color"], {
    cwd,
    timeoutMs,
  });
  const untracked = await readUntrackedDiff(cwd, timeoutMs);
  return {
    diff: [working.stdout, untracked].filter((part) => part.trim()).join("\n\n"),
    source: "working tree",
  };
}

async function readUntrackedDiff(cwd: string, timeoutMs: number): Promise<string> {
  const listed = await runProcess("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd,
    timeoutMs,
  });
  const files = listed.stdout.split("\0").filter(Boolean);
  const selected = files.slice(0, 50);
  const parts: string[] = [];

  for (const file of selected) {
    const diff = await runProcess("git", ["diff", "--no-index", "--no-color", "--", "/dev/null", file], {
      cwd,
      timeoutMs,
      acceptedExitCodes: [0, 1],
    });
    parts.push(diff.stdout || `Untracked file: ${file}`);
  }

  if (files.length > selected.length) {
    parts.push(`Additional untracked files omitted: ${files.length - selected.length}`);
  }

  return parts.join("\n\n");
}

async function runCodex(cwd: string, prompt: string, settings: CodexCommitConfig): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "codex-commit-message-"));
  const outputFile = join(tempDir, "message.txt");
  const args = ["exec", "--cd", cwd, "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "-o", outputFile];

  if (settings.codex.ignoreUserConfig) {
    args.push("--ignore-user-config");
  }

  if (settings.codex.ignoreRules) {
    args.push("--ignore-rules");
  }

  if (settings.codex.model) {
    args.push("--model", settings.codex.model);
  }

  if (settings.codex.reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${settings.codex.reasoningEffort}"`);
  }

  args.push("-");

  try {
    const result = await runProcess(settings.codex.path, args, {
      cwd,
      timeoutMs: settings.codex.timeoutMs,
      input: prompt,
    });
    outputChannel?.appendLine(result.stderr.trim());

    const message = await readFile(outputFile, "utf8").catch(() => "");
    return message || result.stdout;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function resolveGeneratedByAuthor(cwd: string, settings: CodexCommitConfig): Promise<string> {
  if (!settings.message.generatedBy) {
    return "";
  }

  const author = settings.message.generatedByAuthor;
  if (author === "git_author") {
    const name = await readGitConfigValue(cwd, "user.name", settings.codex.timeoutMs);
    const email = await readGitConfigValue(cwd, "user.email", settings.codex.timeoutMs);
    if (name && email) {
      return `${name} <${email}>`;
    }
    return name || email || "unknown";
  }

  if (author === "git_user") {
    return await readGitConfigValue(cwd, "user.name", settings.codex.timeoutMs) || "unknown";
  }

  return author;
}

async function readGitConfigValue(cwd: string, key: string, timeoutMs: number): Promise<string> {
  const result = await runProcess("git", ["config", "--get", key], {
    cwd,
    timeoutMs,
    acceptedExitCodes: [0, 1],
  });
  return result.stdout.trim();
}

function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    input?: string;
    acceptedExitCodes?: number[];
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const acceptedExitCodes = options.acceptedExitCodes ?? [0];
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error(`${command} timed out after ${options.timeoutMs}ms.`));
        return;
      }

      const exitCode = code ?? -1;
      if (!acceptedExitCodes.includes(exitCode)) {
        const reason = stderr.trim() || stdout.trim() || `exit code ${exitCode}${signal ? `, signal ${signal}` : ""}`;
        reject(new Error(`${command} failed: ${reason}`));
        return;
      }

      resolve({ stdout, stderr });
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function userConfigPath(): string {
  return join(homedir(), ".config", "codex-commit-message", "config.toml");
}

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return resolve(path);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function appendLimited(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  const bytes = Buffer.from(next, "utf8");
  if (bytes.byteLength <= OUTPUT_LIMIT_BYTES) {
    return next;
  }

  return bytes.subarray(bytes.byteLength - OUTPUT_LIMIT_BYTES).toString("utf8");
}
