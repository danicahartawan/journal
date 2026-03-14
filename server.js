import "dotenv/config";
import express from "express";
import cors from "cors";
import Exa from "exa-js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files (journaldraft.html)
app.use(express.static(__dirname));

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

app.listen(PORT, () => {
  console.log(`Journal running at http://localhost:${PORT}`);
  if (!process.env.EXA_API_KEY) {
    console.warn("Warning: EXA_API_KEY not set. Neural search will not work.");
  }
});
