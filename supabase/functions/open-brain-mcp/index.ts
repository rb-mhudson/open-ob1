import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

// --- MCP Server Setup ---

const server = new McpServer({
  name: "open-brain",
  version: "1.0.0",
});

// Tool 1: Semantic Search
server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.5),
    },
  },
  async ({ query, limit, threshold }) => {
    try {
      const qEmb = await getEmbedding(query);
      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit,
        filter: {},
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
          isError: true,
        };
      }

      // Filter out expired thoughts
      const now = new Date();
      const vectorActive = (data || []).filter(
        (t: { expiry?: string }) => !t.expiry || new Date(t.expiry) > now
      );

      // Topic keyword fallback: find thoughts whose topic tags match any query word
      const vectorIds = new Set(vectorActive.map((t: { id: string }) => t.id));
      const queryWords = [...new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length > 1))];
      const topicHits: Record<string, unknown>[] = [];
      for (const word of queryWords) {
        const { data: td } = await supabase
          .from("thoughts")
          .select("id, content, metadata, created_at, expiry, recall_counter")
          .contains("metadata", { topics: [word] })
          .or(`expiry.is.null,expiry.gt.${now.toISOString()}`)
          .limit(limit);
        for (const t of td || []) {
          if (!vectorIds.has(t.id) && !topicHits.find((h) => h.id === t.id)) {
            topicHits.push({ ...t, similarity: null, keyword_match: true });
          }
        }
      }

      // Merge: vector results first, then topic-only hits
      const active = [...vectorActive, ...topicHits];

      if (active.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
        };
      }

      // Stamp recall on high-confidence hits (>= 0.8 similarity)
      const recallIds = active
        .filter((t: { similarity: number | null }) => t.similarity != null && t.similarity >= 0.8)
        .map((t: { id: string }) => t.id);
      if (recallIds.length > 0) {
        await supabase.rpc("record_recall", { p_ids: recallIds });
      }

      const results = active.map(
        (
          t: {
            id: string;
            content: string;
            metadata: Record<string, unknown>;
            similarity: number | null;
            keyword_match?: boolean;
            created_at: string;
            expiry?: string;
            recall_counter?: number;
          },
          i: number
        ) => {
          const m = t.metadata || {};
          const matchLabel = t.keyword_match
            ? "topic keyword match"
            : `${(t.similarity! * 100).toFixed(1)}% match`;
          const parts = [
            `--- Result ${i + 1} (${matchLabel}) [${t.id}] ---`,
            `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
            `Type: ${m.type || "unknown"}`,
          ];
          if (Array.isArray(m.topics) && m.topics.length)
            parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
          if (Array.isArray(m.people) && m.people.length)
            parts.push(`People: ${(m.people as string[]).join(", ")}`);
          if (Array.isArray(m.action_items) && m.action_items.length)
            parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
          if (t.expiry) parts.push(`Expires: ${new Date(t.expiry).toLocaleDateString()}`);
          if (t.recall_counter) parts.push(`Recalled: ${t.recall_counter}x`);
          parts.push(`\n${t.content}`);
          return parts.join("\n");
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${active.length} thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: List Recent
server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description:
      "List recently captured thoughts with optional filters by type, topic, person, or time range. Optionally retrieve by ID.",
    inputSchema: {
      id: z.string().optional().describe("UUID of specific thought to retrieve"),
      limit: z.number().optional().default(10),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
      include_expired: z.boolean().optional().default(false).describe("Include expired thoughts (admin use)"),
    },
  },
  async ({ id, limit, type, topic, person, days, include_expired }) => {
    try {
      // If ID provided, fetch directly without filters
      if (id) {
        const { data: thought, error } = await supabase
          .from("thoughts")
          .select("id, content, metadata, created_at, expiry, recall_counter")
          .eq("id", id)
          .single();

        if (error || !thought) {
          return {
            content: [{ type: "text" as const, text: `Thought not found: ${id}` }],
            isError: true,
          };
        }

        const m = thought.metadata || {};
        const parts = [
          `[${thought.id}]`,
          `Captured: ${new Date(thought.created_at).toLocaleDateString()}`,
          `Type: ${m.type || "unknown"}`,
        ];
        if (Array.isArray(m.topics) && m.topics.length)
          parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
        if (Array.isArray(m.people) && m.people.length)
          parts.push(`People: ${(m.people as string[]).join(", ")}`);
        if (Array.isArray(m.action_items) && m.action_items.length)
          parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
        if (thought.expiry) parts.push(`Expires: ${new Date(thought.expiry).toLocaleDateString()}`);
        if (thought.recall_counter) parts.push(`Recalled: ${thought.recall_counter}x`);
        parts.push(`\n${thought.content}`);

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
        };
      }

      // Otherwise, apply filters and list
      let q = supabase
        .from("thoughts")
        .select("id, content, metadata, created_at, expiry, recall_counter")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (type) q = q.contains("metadata", { type });
      if (topic) q = q.contains("metadata", { topics: [topic] });
      if (person) q = q.contains("metadata", { people: [person] });
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }
      if (!include_expired) q = q.or(`expiry.is.null,expiry.gt.${new Date().toISOString()}`);

      const { data, error } = await q;

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || !data.length) {
        return { content: [{ type: "text" as const, text: "No thoughts found." }] };
      }

      const results = data.map(
        (
          t: { id: string; content: string; metadata: Record<string, unknown>; created_at: string; expiry?: string; recall_counter?: number },
          i: number
        ) => {
          const m = t.metadata || {};
          const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
          const extra = [
            t.expiry ? `expires:${new Date(t.expiry).toLocaleDateString()}` : "",
            t.recall_counter ? `recalled:${t.recall_counter}x` : "",
          ].filter(Boolean).join(" ");
          return `${i + 1}. [${t.id}] [${new Date(t.created_at).toLocaleDateString()}] (${m.type || "??"}${tags ? " - " + tags : ""})${extra ? " " + extra : ""}\n   ${t.content}`;
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: Stats
server.registerTool(
  "thought_stats",
  {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const { count } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true });

      const { data } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .order("created_at", { ascending: false });

      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};

      for (const r of data || []) {
        const m = (r.metadata || {}) as Record<string, unknown>;
        if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
        if (Array.isArray(m.topics))
          for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
        if (Array.isArray(m.people))
          for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
      }

      const sort = (o: Record<string, number>): [string, number][] =>
        Object.entries(o)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

      const lines: string[] = [
        `Total thoughts: ${count}`,
        `Date range: ${
          data?.length
            ? new Date(data[data.length - 1].created_at).toLocaleDateString() +
              " → " +
              new Date(data[0].created_at).toLocaleDateString()
            : "N/A"
        }`,
        "",
        "Types:",
        ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
      ];

      if (Object.keys(topics).length) {
        lines.push("", "Top topics:");
        for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
      }

      if (Object.keys(people).length) {
        lines.push("", "People mentioned:");
        for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: Capture Thought
server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description:
      "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically. Use this when the user wants to save something to their brain directly from any AI client — notes, insights, decisions, or migrated content from other systems.",
    inputSchema: {
      content: z.string().describe("The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI"),
    },
  },
  async ({ content }) => {
    try {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(content),
        extractMetadata(content),
      ]);

      const { data: upsertResult, error: upsertError } = await supabase.rpc("upsert_thought", {
        p_content: content,
        p_payload: { metadata: { ...metadata, source: "mcp" } },
      });

      if (upsertError) {
        return {
          content: [{ type: "text" as const, text: `Failed to capture: ${upsertError.message}` }],
          isError: true,
        };
      }

      const thoughtId = upsertResult?.id;
      const { error: embError } = await supabase
        .from("thoughts")
        .update({ embedding })
        .eq("id", thoughtId);

      if (embError) {
        return {
          content: [{ type: "text" as const, text: `Failed to save embedding: ${embError.message}` }],
          isError: true,
        };
      }

      const meta = metadata as Record<string, unknown>;
      let confirmation = `Captured as ${meta.type || "thought"}`;
      if (Array.isArray(meta.topics) && meta.topics.length)
        confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
      if (Array.isArray(meta.people) && meta.people.length)
        confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
      if (Array.isArray(meta.action_items) && meta.action_items.length)
        confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;

      return {
        content: [{ type: "text" as const, text: confirmation }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 5: Update Thought
server.registerTool(
  "update_thought",
  {
    title: "Update Thought",
    description:
      "Update an existing thought by ID. Can patch content (re-embeds), merge metadata fields, set an expiry date, or archive (soft-delete) it.",
    inputSchema: {
      id: z.string().describe("UUID of the thought to update"),
      content: z.string().optional().describe("Replace content — triggers re-embedding and new fingerprint"),
      metadata_patch: z.record(z.unknown()).optional().describe("Fields to merge into existing metadata"),
      expiry: z.string().nullable().optional().describe("ISO date after which the thought is hidden, or null to clear"),
      archived: z.boolean().optional().describe("Set true to soft-delete (sets expiry to now)"),
    },
  },
  async ({ id, content, metadata_patch, expiry, archived }) => {
    try {
      // Fetch existing thought
      const { data: existing, error: fetchError } = await supabase
        .from("thoughts")
        .select("id, content, metadata, content_fingerprint")
        .eq("id", id)
        .single();

      if (fetchError || !existing) {
        return {
          content: [{ type: "text" as const, text: `Thought not found: ${id}` }],
          isError: true,
        };
      }

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const changed: string[] = [];

      // Content update — re-fingerprint and re-embed in place
      if (content !== undefined) {
        const [embedding, metadata] = await Promise.all([
          getEmbedding(content),
          extractMetadata(content),
        ]);
        const normalized = content.toLowerCase().trim().replace(/\s+/g, " ");
        const hashBuffer = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(normalized),
        );
        const fingerprint = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        updates.content = content;
        updates.content_fingerprint = fingerprint;
        updates.embedding = embedding;
        updates.metadata = { ...metadata, source: "mcp" };
        changed.push("content");
      }

      // Metadata patch — merge into existing
      if (metadata_patch !== undefined) {
        updates.metadata = { ...(existing.metadata || {}), ...metadata_patch };
        changed.push("metadata");
      }

      // Expiry — set or clear
      if (archived) {
        updates.expiry = new Date().toISOString();
        changed.push("archived");
      } else if (expiry !== undefined) {
        updates.expiry = expiry ?? null;
        changed.push(expiry ? `expiry→${expiry}` : "expiry cleared");
      }

      if (Object.keys(updates).length > 1) {
        const { error: updateError } = await supabase
          .from("thoughts")
          .update(updates)
          .eq("id", id);
        if (updateError) {
          return {
            content: [{ type: "text" as const, text: `Update failed: ${updateError.message}` }],
            isError: true,
          };
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: changed.length
            ? `Updated [${id}]: ${changed.join(", ")}`
            : `No changes applied to [${id}]`,
        }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// --- Hono App with Auth + CORS ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

// Create transport once and reuse across requests (required by @hono/mcp@0.2.x)
const transport = new StreamableHTTPTransport();

const app = new Hono();

// CORS preflight — required for browser/Electron-based clients (Claude Desktop, claude.ai)
app.options("*", (c) => {
  return c.text("ok", 200, corsHeaders);
});

app.all("*", async (c) => {
  // Accept access key via header OR URL query parameter
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  }

  if (!server.isConnected()) {
    await server.connect(transport);
  }

  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
