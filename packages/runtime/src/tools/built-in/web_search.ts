import type { ToolDefinition } from "@sockt/types";
import type { ToolHandler } from "../../types.ts";

export const webSearchDefinition: ToolDefinition = {
  name: "web_search",
  description: "Search the web for information. Returns summaries and relevant results for a query.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
      limit: { type: "number", description: "Max results to return (default 5)" },
    },
    required: ["query"],
  },
};

export const webSearchHandler: ToolHandler = async (args) => {
  const query = String(args.query ?? "");
  const limit = Number(args.limit ?? 5);

  // Tavily first if configured — built for agent/LLM search (real ranked
  // results with content snippets), not just instant-answer lookups. Brave
  // next if configured. DuckDuckGo instant-answers last: it isn't a real
  // search API (no ranked web results, just Wikipedia-style abstracts), so it
  // returns empty for most real queries — this was silently starving every
  // growth web_search call before Tavily was configured (see G1 in the
  // 2026-07-11 eval: 9 real web_search calls, 0 usable results).
  const tavilyKey = process.env.TAVILY_API_KEY;
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;

  if (tavilyKey) {
    return searchTavily(query, limit, tavilyKey);
  }
  if (braveKey) {
    return searchBrave(query, limit, braveKey);
  }
  return searchDuckDuckGo(query, limit);
};

async function searchTavily(query: string, limit: number, apiKey: string) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: limit }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`Tavily Search error: ${res.status}`);
  const data = await res.json() as { results?: { title: string; url: string; content: string }[] };

  const results = (data.results ?? []).slice(0, limit).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));

  return { query, results, source: "tavily" };
}

async function searchBrave(query: string, limit: number, apiKey: string) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`Brave Search error: ${res.status}`);
  const data = await res.json() as { web?: { results?: { title: string; url: string; description: string }[] } };

  const results = (data.web?.results ?? []).slice(0, limit).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));

  return { query, results, source: "brave" };
}

async function searchDuckDuckGo(query: string, limit: number) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

  if (!res.ok) throw new Error(`DuckDuckGo error: ${res.status}`);
  const data = await res.json() as {
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: { Text?: string; FirstURL?: string }[];
  };

  const results: { title: string; url: string; snippet: string }[] = [];

  if (data.AbstractText) {
    results.push({ title: query, url: data.AbstractURL ?? "", snippet: data.AbstractText });
  }

  for (const topic of (data.RelatedTopics ?? []).slice(0, limit - results.length)) {
    if (topic.Text) {
      results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL ?? "", snippet: topic.Text });
    }
  }

  if (results.length === 0) {
    return { query, results: [], note: "No instant answers found. Try a more specific query." };
  }

  return { query, results: results.slice(0, limit), source: "duckduckgo" };
}
