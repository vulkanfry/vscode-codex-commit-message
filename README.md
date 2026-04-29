# Codex Commit Message

Adds a Source Control action that uses Codex CLI to generate a Git commit message from the current diff.

The command is available from the stable Source Control title toolbar as a terminal icon, the Source Control repository menu, and the Command Palette. It reads staged changes first by default, falls back to the working tree when nothing is staged, and writes the generated message into the active Git repository commit input.

VS Code's `scm/inputBox` menu, the exact slot used by Copilot's commit-message sparkle button, is still proposed API for third-party extensions. This extension avoids that proposed API so it works after normal installation without launching VS Code with `--enable-proposed-api`.

## Config

Run `Codex: Open Commit Message Config` from the Command Palette to create or edit:

```text
~/.config/codex-commit-message/config.toml
```

Project-specific overrides can live at:

```text
.codex-commit-message.toml
```

Precedence is: built-in defaults, VS Code fallback settings, user TOML, workspace TOML. If `codexCommitMessage.configPath` is set, that single TOML file is used instead of the user/workspace pair.

Useful defaults:

```toml
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
mode = "summary"
conventional_commits = true
language = "auto"
include_body = "auto"
max_subject_chars = 72
generated_by = false
generated_by_author = "git_author"
generated_by_format = "Generated via Codex Commit Message by {author}"
```

Set `message.mode = "expanded"` and `message.include_body = "always"` when you want a subject plus body. Set `message.generated_by = true` to append the configured attribution footer after Codex returns the message.

Every TOML leaf also has a matching VS Code setting under `codexCommitMessage.*`. TOML remains useful for sharing repo-local defaults, while VS Code settings are convenient for user-level overrides.

## Development

```bash
bun install
bun test src/**/*.test.ts
bun run compile
bun run package
```
