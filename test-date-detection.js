// test-date-detection.js
// Quick TDD validation of the date detection heuristic.
// Run with: node test-date-detection.js
// This does NOT require a Groq API key.

// ---- Copy the helper functions from server.js for isolated testing ----

function isDateInPast(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date < today;
}

function detectPastDateInMessage(text) {
  const currentYear = new Date().getFullYear();
  const lowerText = text.toLowerCase();

  if (lowerText.includes("yesterday")) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
  }

  const dmyMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(parsed) && isDateInPast(parsed)) return parsed;
  }

  const isoMatch = text.match(/\b(\d{4})[\/\-](\d{2})[\/\-](\d{2})\b/);
  if (isoMatch) {
    const parsed = new Date(isoMatch[0]);
    if (!isNaN(parsed) && isDateInPast(parsed)) return parsed;
  }

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
      day = Number(namedMatch[1]);
      monthStr = namedMatch[2];
      year = namedMatch[3] ? Number(namedMatch[3]) : currentYear;
    } else {
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

// ---- Test runner ----

let passed = 0;
let failed = 0;

function test(description, input, expectPast) {
  const result = detectPastDateInMessage(input);
  const gotPast = result !== null;
  const ok = gotPast === expectPast;
  const status = ok ? "✅ PASS" : "❌ FAIL";
  console.log(`${status} | ${description}`);
  if (!ok) {
    console.log(`       Input: "${input}"`);
    console.log(`       Expected isPast=${expectPast}, got isPast=${gotPast} (date: ${result})`);
  }
  ok ? passed++ : failed++;
}

// Current date for reference (today is 2026-08-16 per session metadata)
console.log(`\nRunning date detection tests. Today is: ${new Date().toDateString()}\n`);

// --- SHOULD detect as past date ---
test("'yesterday' keyword", "yesterday", true);
test("DD/MM/YYYY clearly in past", "Let's meet on 01/01/2025", true);
test("DD-MM-YYYY clearly in past", "How about 10-03-2024", true);
test("ISO format clearly in past", "Booking for 2025-01-15 please", true);
test("'5 August' (this year, already passed if we're in Aug 2026)", "How about 5 August", true);
test("'August 5' format", "Let's say August 5", true);
test("'15 January 2025' named month with year", "I want 15 January 2025", true);
test("'January 15, 2025' named month with year reversed", "Maybe January 15, 2025", true);

// --- SHOULD NOT detect as past date (future or no date) ---
test("No date in message", "What's the price of a 3 BHK?", false);
test("Future date DD/MM/YYYY", "Can I visit on 25/12/2030", false);
test("Future date named month no year (future month)", "How about 20 September", false);
test("Ambiguous relative 'next week'", "Call me next week please", false);
test("Just a number with no date context", "I need 3 bedrooms", false);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
