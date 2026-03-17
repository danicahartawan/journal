import "dotenv/config";
import express from "express";
import cors from "cors";
import Exa from "exa-js";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Supabase client
const supabase = (process.env.SUPABASE_URL &&
                  process.env.SUPABASE_ANON_KEY &&
                  process.env.SUPABASE_URL.startsWith('http') &&
                  !process.env.SUPABASE_URL.includes('your_'))
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

// Initialize OpenAI client
const openai = process.env.OPEN_AI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPEN_AI_API_KEY })
  : null;

// Serve static files
app.use(express.static(__dirname));

// Serve journaldraft.html at root (Express looks for index.html by default)
app.get("/", (req, res) => res.sendFile(join(__dirname, "journaldraft.html")));

const exa = new Exa(process.env.EXA_API_KEY);

app.post("/api/exa-search", async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Missing or invalid query" });
  }

  if (!process.env.EXA_API_KEY) {
    return res.status(500).json({ error: "Exa API key not configured. Add EXA_API_KEY to .env" });
  }

  try {
    const result = await exa.search(query.trim(), {
      type: "neural",
      numResults: 8,
      contents: {
        highlights: { maxCharacters: 600 }
      }
    });
    res.json(result);
  } catch (err) {
    console.error("Exa search error:", err);
    res.status(500).json({
      error: err.message || "Search failed",
      details: err.response?.data || undefined
    });
  }
});

// Save library items to Supabase
app.post("/api/library/save", async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Invalid items array" });
  }

  try {
    const { data, error } = await supabase
      .from("library_items")
      .upsert(items, { onConflict: "url" });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error("Supabase save error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get library items from Supabase
app.get("/api/library", async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  try {
    const { data, error } = await supabase
      .from("library_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ items: data || [] });
  } catch (err) {
    console.error("Supabase fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Save journal sources to Supabase
app.post("/api/journals/:journalId/sources", async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const { journalId } = req.params;
  const { sources } = req.body;

  try {
    const { data, error } = await supabase
      .from("journal_sources")
      .upsert({ journal_id: journalId, sources, updated_at: new Date() }, { onConflict: "journal_id" });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error("Supabase save error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get journal sources from Supabase
app.get("/api/journals/:journalId/sources", async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const { journalId } = req.params;

  try {
    const { data, error } = await supabase
      .from("journal_sources")
      .select("sources")
      .eq("journal_id", journalId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    res.json({ sources: data?.sources || [] });
  } catch (err) {
    console.error("Supabase fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Chat with AI journalist assistant
app.post("/api/chat", async (req, res) => {
  if (!openai) {
    return res.status(500).json({ error: "OpenAI not configured" });
  }

  const { messages, sources } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Invalid messages array" });
  }

  try {
    // Build context from sources
    let sourceContext = "";
    if (sources && sources.length > 0) {
      sourceContext = "\n\nAvailable sources for this story:\n" + sources.map((s, i) =>
        `[${i + 1}] ${s.title}\nURL: ${s.url}\nSummary: ${s.summary.slice(0, 500)}\n`
      ).join("\n");
    }

    const systemPrompt = `You are an expert investigative journalist assistant. Your role is to help journalists build compelling, well-researched stories. You have access to various sources and can help:

- Analyze documents and extract key insights
- Identify connections between different sources
- Suggest story angles and narrative structures
- Find gaps in coverage that need more research
- Draft sections of articles with proper sourcing
- Fact-check claims and verify information
- Ask probing questions to deepen the investigation

When referencing sources, use the format [Source N] where N is the source number.
Be thorough, critical, and always maintain journalistic integrity.${sourceContext}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 2000
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (err) {
    console.error("OpenAI chat error:", err);
    res.status(500).json({ error: err.message || "Chat failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Journal running at http://localhost:${PORT}`);
  if (!process.env.EXA_API_KEY) {
    console.warn("Warning: EXA_API_KEY not set. Neural search will not work.");
  }
  if (!supabase) {
    console.warn("Warning: Supabase not configured. Database features will not work.");
  }
  if (!openai) {
    console.warn("Warning: OpenAI not configured. AI chat will not work.");
  }
});
