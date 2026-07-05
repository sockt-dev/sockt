## Summary

<!-- What does this PR change, and why? Link the issue if there is one. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation
- [ ] Refactor / cleanup (no behavior change)

## Which part of Sockt does this touch

- [ ] Orchestrator (`@sockt/orch`)
- [ ] Runtime / agent loop (`@sockt/runtime`)
- [ ] Built-in tools
- [ ] Departments / skills
- [ ] Memory pipeline (`@sockt/cadvp`, `@sockt/gbrain-mcp`)
- [ ] Rust CLI (`sockt`)
- [ ] UI dashboard
- [ ] Docs only

## Test plan

<!--
How did you verify this works? Check what applies and describe specifics.
See CONTRIBUTING.md#running-tests for the full test commands.
-->

- [ ] `bun test` passes
- [ ] `cargo test` passes (if Rust changed)
- [ ] Manually verified: <!-- describe what you ran and what you observed,
        e.g. "started orch + runtime, fired `sockt ask ...`, confirmed task
        reached `completed` with expected output" -->

## Breaking changes

<!-- If this changes an API route, env var, CLI flag, or config format,
     call it out explicitly here so it can be flagged in release notes. -->

## Checklist

- [ ] I've read [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] New/changed behavior has test coverage, or I've explained why manual
      verification was sufficient
- [ ] No unrelated formatting/refactor changes mixed into this diff
- [ ] Docs updated if this changes config, API routes, or CLI behavior
