---
name: Bug report
about: Something in Sockt isn't working as expected
title: "[BUG] "
labels: bug
assignees: ''
---

## What happened

<!-- A clear description of the bug -->

## What you expected

<!-- What should have happened instead -->

## Steps to reproduce

1.
2.
3.

If this is task/agent related, include the **exact task description** you
used (`sockt ask "..."` or the `POST /tasks` body) — reproducing agent
behavior usually requires the exact prompt.

## Environment

- Sockt version / commit: <!-- `sockt --version` or `git rev-parse HEAD` -->
- OS: <!-- Windows / macOS / Linux + version -->
- Bun version: <!-- `bun --version` -->
- Rust version (if CLI-related): <!-- `rustc --version` -->
- LLM provider: <!-- anthropic / openai / groq / ollama -->
- Docker AI Sandbox installed?: <!-- yes/no — `sbx ls --json` -->

## Logs / output

<!-- Paste relevant output from `sockt logs`, terminal output, or the
     orchestrator/runtime process logs. Use a code block. Redact API keys. -->

```

```

## Additional context

<!-- Anything else that might help — did this work before a specific
     commit/version? Is it department-specific? -->
