# Sockt

AI agent swarms that won't bankrupt you or embarrass you.

Sockt is an open-core platform for deploying coordinated AI agent teams ("Swarms") into your workspace. Unlike single-agent tools, Swarms divide complex workflows into specialized roles that share memory, prevent runaway cost loops, and improve automatically over time.

## Why Sockt?

Most multi-agent systems fail in production due to runaway loops (agents ping-pong indefinitely, burning thousands in API costs), memory loss (background tasks forget everything they learned), and credential leakage (API keys exposed in agent context windows).

Sockt solves these with hierarchical task coordination that prevents loops, persistent Git-backed memory that's human-readable and version-controlled, and hardware-isolated credential vaults that keep secrets safe from prompt injection attacks.

## Built With

Rust + TypeScript (Bun runtime). Open-core license converts to MIT after 2 years.
