import type { ToolDefinition } from "@sockt/types";
import type { ToolHandler } from "../../types.ts";

export const githubCreateIssueDefinition: ToolDefinition = {
  name: "github_create_issue",
  description:
    "Create a REAL issue in the configured GitHub repository. Requires human approval. Use ONLY after the issue body (user story, acceptance criteria, out-of-scope) is fully drafted.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Issue title, conventional format e.g. 'feat: Add email verification flow'" },
      body: { type: "string", description: "Full markdown body: User Story, Context, Acceptance Criteria (Given/When/Then), Technical Notes, Out of Scope" },
      labels: { type: "array", description: "Labels, e.g. [\"feat\",\"p1\",\"m\"]" },
      repo: { type: "string", description: "owner/name override; defaults to the configured GITHUB_REPO" },
    },
    required: ["title", "body"],
  },
};

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export const makeGithubCreateIssueHandler = (opts: { token?: string; defaultRepo?: string }): ToolHandler => async (args) => {
  if (!opts.token) {
    throw new Error(
      "github_create_issue is not configured (GITHUB_TOKEN missing) — save the issues to a file with write_file and tell the user they must be created manually.",
    );
  }

  const title = String(args.title ?? "").trim();
  const body = String(args.body ?? "").trim();
  if (!title || !body) {
    throw new Error("github_create_issue requires a non-empty title and body.");
  }

  const repo = String(args.repo ?? opts.defaultRepo ?? "");
  if (!repo) {
    throw new Error(
      "github_create_issue is not configured (GITHUB_REPO missing and no repo override given) — save the issues to a file with write_file and tell the user they must be created manually.",
    );
  }
  if (!REPO_PATTERN.test(repo)) {
    throw new Error(`github_create_issue: repo "${repo}" is not a valid owner/name.`);
  }

  const labels = Array.isArray(args.labels) ? args.labels.map(String) : undefined;

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "sockt-agent",
    },
    body: JSON.stringify({ title, body, labels }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`github_create_issue failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url, title, repo };
};
