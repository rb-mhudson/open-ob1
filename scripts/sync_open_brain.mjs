import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import { join } from "path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
// NOTE: rclone syncs this path to Google Drive
const EXPORT_DIR = "./OpenBrainSync";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in your environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sync() {
  console.log("Fetching thoughts from Supabase...");
  const { data, error } = await supabase
    .from("thoughts")
    .select("id, content, metadata, created_at")
    .or(`expiry.is.null,expiry.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching thoughts:", error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log("No thoughts found.");
    return;
  }

  // Create export directory
  await fs.mkdir(EXPORT_DIR, { recursive: true });

  console.log(`Syncing ${data.length} thoughts to ${EXPORT_DIR}...`);

  for (const thought of data) {
    const { id, content, metadata, created_at } = thought;
    const m = metadata || {};
    const date = new Date(created_at).toISOString().split("T")[0];
    
    // Create a filename based on date and first few words of content
    const snippet = content.slice(0, 30).replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const filename = `${date}_${snippet}_${id.slice(0, 5)}.md`;
    const filePath = join(EXPORT_DIR, filename);

    // Format content with Frontmatter
    const frontmatter = [
      "---",
      `date: ${created_at}`,
      `type: ${m.type || "observation"}`,
      `topics: [${(m.topics || []).join(", ")}]`,
      `people: [${(m.people || []).join(", ")}]`,
      "---",
      "",
      content
    ].join("\n");

    try {
      await fs.writeFile(filePath, frontmatter, "utf-8");
    } catch (e) {
      console.error(`Failed to write ${filename}:`, e);
    }
  }

  console.log("Sync complete!");
}

/**
 * Parse a markdown file with optional YAML-ish frontmatter.
 * Returns { content, metadata } where metadata fields are strings or string[].
 */
function parseMd(raw) {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { content: raw.trim(), metadata: {} };

  const metadata = {};
  for (const line of fmMatch[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
    }
    if (key) metadata[key] = val;
  }
  return { content: fmMatch[2].trim(), metadata };
}

async function getEmbedding(text) {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  const json = await res.json();
  return json.data?.[0]?.embedding ?? null;
}

async function ingestInbox() {
  if (!OPENROUTER_API_KEY) {
    console.warn("Missing OPENROUTER_API_KEY — skipping inbox ingestion.");
    return;
  }

  const inboxDir = join(EXPORT_DIR, "inbox");
  const processedDir = join(inboxDir, "processed");
  await fs.mkdir(inboxDir, { recursive: true });
  await fs.mkdir(processedDir, { recursive: true });

  const files = (await fs.readdir(inboxDir)).filter(f => f.endsWith(".md"));
  if (files.length === 0) {
    console.log("No inbox files to ingest.");
    return;
  }

  console.log(`Ingesting ${files.length} inbox file(s)...`);

  for (const filename of files) {
    const filePath = join(inboxDir, filename);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const { content, metadata } = parseMd(raw);

      if (!content.trim()) {
        console.warn(`Skipping empty file: ${filename}`);
        continue;
      }

      const embedding = await getEmbedding(content);

      const { data: id, error: upsertError } = await supabase.rpc("upsert_thought", {
        p_content: content,
        p_payload: metadata,
      });
      if (upsertError) throw new Error(upsertError.message);

      if (embedding) {
        const { error: embError } = await supabase
          .from("thoughts")
          .update({ embedding })
          .eq("id", id);
        if (embError) console.warn(`Embedding update failed for ${filename}:`, embError.message);
      }

      await fs.rename(filePath, join(processedDir, filename));
      console.log(`Ingested: ${filename}`);
    } catch (e) {
      console.error(`Failed to ingest ${filename}:`, e.message);
    }
  }

  console.log("Inbox ingestion complete.");
}

async function main() {
  await ingestInbox();
  await sync();
}

main();
