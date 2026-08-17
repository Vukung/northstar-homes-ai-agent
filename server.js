// server.js
// Express server for the Northstar Homes AI sales bot.
// Handles chat sessions (in-memory), calls Groq LLM, and generates lead analytics on session end.

require("dotenv").config();
const express = require("express");
const path = require("path");
const { SYSTEM_PROMPT } = require("./prompt");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// In-memory session store: sessionId -> { history: Array<{ role, content }>, optedOut: boolean }
// This is intentionally simple — no persistence across server restarts.
// ---------------------------------------------------------------------------
const sessions = {};

// ---------------------------------------------------------------------------
// Date detection helpers
// Checks whether the user's message references a date that is clearly in the
// past relative to the current server date. This is a lightweight heuristic
// that covers common formats used in chat (not a full NLP date parser).
// ---------------------------------------------------------------------------

/**
 * Given a Date object, returns true if it represents a date strictly before today
 * (ignoring time-of-day — we compare calendar dates only).
 */
function isDateInPast(date) {
  const today = new Date();
  // Zero out time components to compare calendar dates only
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date < today;
}

/**
 * Tries to extract a date from a free-text message and returns it if it is
 * clearly in the past. Returns null if no past date is detected.
 *
 * Heuristics handled:
 *  1. "yesterday"
 *  2. DD/MM/YYYY or DD-MM-YYYY
 *  3. "15 August" / "15 August 2025" / "August 15" / "August 15 2025"
 *  4. ISO format YYYY-MM-DD
 *
 * Ambiguous dates (e.g. "Friday", "next week") are ignored — the LLM's
 * BOOKING FAILURE guardrail in the prompt handles any remaining cases.
 */
function detectPastDateInMessage(text) {
  const currentYear = new Date().getFullYear();
  const lowerText = text.toLowerCase();

  // 1. "yesterday"
  if (lowerText.includes("yesterday")) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday; // always in the past
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(parsed) && isDateInPast(parsed)) return parsed;
  }

  // 3. ISO format YYYY-MM-DD
  const isoMatch = text.match(/\b(\d{4})[\/\-](\d{2})[\/\-](\d{2})\b/);
  if (isoMatch) {
    const parsed = new Date(isoMatch[0]);
    if (!isNaN(parsed) && isDateInPast(parsed)) return parsed;
  }

  // 4. "15 August", "15 August 2025", "August 15", "August 15, 2025"
  const monthNames =
    "january|february|march|april|may|june|july|august|september|october|november|december";
  const monthPattern = new RegExp(
    `\\b(\\d{1,2})\\s+(${monthNames})(?:[,\\s]+(\\d{4}))?\\b|\\b(${monthNames})\\s+(\\d{1,2})(?:[,\\s]+(\\d{4}))?\\b`,
    "i"
  );
  const namedMatch = text.match(monthPattern);
  if (namedMatch) {
    let day, monthStr, year;
    if (namedMatch[1]) {
      // "15 August [2025]"
      day = Number(namedMatch[1]);
      monthStr = namedMatch[2];
      year = namedMatch[3] ? Number(namedMatch[3]) : currentYear;
    } else {
      // "August 15 [2025]"
      monthStr = namedMatch[4];
      day = Number(namedMatch[5]);
      year = namedMatch[6] ? Number(namedMatch[6]) : currentYear;
    }
    const monthIndex = new Date(`${monthStr} 1, 2000`).getMonth();
    const parsed = new Date(year, monthIndex, day);
    if (!isNaN(parsed) && isDateInPast(parsed)) return parsed;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Groq API helper
// Uses Node's native fetch (available in Node 18+).
// ---------------------------------------------------------------------------

/**
 * Calls the Groq chat completions endpoint.
 * @param {Array<{ role: string, content: string }>} messages - Full message array to send.
 * @returns {Promise<string>} - The assistant's reply text.
 */
async function callGroq(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set in environment");

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // model: "llama-3.3-70b-versatile",
        model: "openai/gpt-oss-120b",
        messages,
        temperature: 0.7,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ---------------------------------------------------------------------------
// POST /api/chat
// Body: { sessionId: string, message: string }
// ---------------------------------------------------------------------------
// Conservative opt-out phrase list — errs on the side of avoiding false positives.
const OPT_OUT_PHRASES = [
  "stop contacting",
  "don't contact me",
  "do not contact me",
  "stop messaging",
  "unsubscribe",
  "remove me from",
];

app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "sessionId and message are required" });
  }

  // Initialise session if this is a new session
  if (!sessions[sessionId]) {
    sessions[sessionId] = { history: [], optedOut: false };
  }

  const session = sessions[sessionId];

  // Detect opt-out intent and set the server-side flag permanently for this session.
  const isOptOutMessage = OPT_OUT_PHRASES.some((p) =>
    message.toLowerCase().includes(p)
  );
  if (isOptOutMessage) {
    session.optedOut = true;
  }

  // Short-circuit: once opted out, never call the LLM again.
  if (session.optedOut) {
    const reply =
      "As requested, you won't receive any further messages from us. Take care.";
    session.history.push({ role: "user", content: message });
    session.history.push({ role: "assistant", content: reply });
    return res.json({ reply });
  }

  // Append the user's message to the persistent history
  session.history.push({ role: "user", content: message });

  // Build the message array to send to the LLM:
  //   [system prompt, ...history, optional ephemeral system note]
  const messagesForLLM = [
    { role: "system", content: SYSTEM_PROMPT },
    ...session.history,
  ];

  // Check for a past date reference and inject an ephemeral system note if found.
  // This note is NOT stored in the visible history — it is only sent to the LLM
  // for this single call, so it doesn't pollute future turns.
  const pastDate = detectPastDateInMessage(message);
  if (pastDate) {
    messagesForLLM.push({
      role: "system",
      content:
        "Note: the customer's requested date has already passed. Inform them and ask for a new date.",
    });
  }

  try {
    const reply = await callGroq(messagesForLLM);

    // Persist the assistant reply in the session history
    session.history.push({ role: "assistant", content: reply });

    return res.json({ reply });
  } catch (err) {
    console.error({ error: err.message }, "Error calling Groq API");
    return res
      .status(502)
      .json({ error: "Failed to reach the AI service. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/end-session
// Body: { sessionId: string }
// Summarises the conversation into a structured lead analytics object.
// ---------------------------------------------------------------------------

// Prompt used to extract lead analytics. Kept here (not in prompt.js) because
// it is an internal operational prompt, not a user-facing persona prompt.
const ANALYTICS_PROMPT = `You are a CRM data extraction assistant. You will be given a sales conversation transcript. Output ONLY a valid JSON object — no markdown fences, no explanation, no extra text.

The JSON must have exactly these fields:
- budget_mentioned: string or null (any budget the customer mentioned)
- configuration_interest: "2BHK" | "3BHK" | "undecided"
- purpose: "self-use" | "investment" | "unknown"
- interest_level: "high" | "medium" | "low" | "opted_out"
- site_visit_status: "booked" | "attempted_failed" | "not_discussed"
- site_visit_date: string or null (the confirmed visit date if booked)
- follow_up_required: boolean
- follow_up_preference: string or null (day/time preference if mentioned)
- opted_out: boolean (true if customer explicitly asked to stop being contacted)
- escalation_requested: boolean (true if customer asked for a human)
- summary: string (one sentence summarising the conversation outcome)

Analyse the conversation carefully and return only the JSON.`;

app.post("/api/end-session", async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  const session = sessions[sessionId];
  if (!session || session.history.length === 0) {
    return res
      .status(404)
      .json({ error: "No conversation found for this session" });
  }

  // Format the conversation as a readable transcript for the analytics prompt
  const transcript = session.history
    .map((m) => `${m.role === "user" ? "Customer" : "Riya"}: ${m.content}`)
    .join("\n");

  const analyticsMessages = [
    { role: "system", content: ANALYTICS_PROMPT },
    {
      role: "user",
      content: `Here is the conversation transcript:\n\n${transcript}`,
    },
  ];

  try {
    let rawReply = await callGroq(analyticsMessages);

    // Strip markdown code fences if the model adds them despite instructions
    // e.g. ```json { ... } ``` -> { ... }
    rawReply = rawReply
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    let analytics;
    try {
      analytics = JSON.parse(rawReply);
    } catch (parseErr) {
      console.error("Failed to parse analytics JSON:", rawReply);
      // Return the raw text so the caller still gets something useful
      return res.status(500).json({
        error: "Analytics JSON parse failed",
        rawReply,
      });
    }

    // Log to server console for review (as required by spec)
    console.log("\n=== Lead Analytics (Session: %s) ===", sessionId);
    console.log(JSON.stringify(analytics, null, 2));
    console.log("=====================================\n");

    // Clean up the session from memory
    delete sessions[sessionId];

    return res.json(analytics);
  } catch (err) {
    console.error("Error calling Groq API for analytics:", err.message);
    return res
      .status(502)
      .json({ error: "Failed to generate analytics. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Northstar Homes sales bot running on http://localhost:${PORT}`);
});
