# Test Cases — Northstar Homes AI Sales Agent (Riya)

Each test case below shows the scenario, expected behavior, the actual input/output
from a live run, and notes on what was verified.

---

## Test Case 1: Happy Path — Inquiry, Qualification, and Successful Site Visit Booking

**Scenario:** A genuinely interested buyer asks about the project, shares their needs, and books a future site visit. All booking details are collected one at a time.

**Expected behavior:**
- Booking info requested one field at a time (not batched)
- No markdown, bullets, or emojis in any reply
- Final confirmation turn repeats all four booking details
- No invented facts (amenities, floor plans, possession date, etc.)

**Actual conversation:**
```
Riya: Hi there! I'm Riya from Northstar Homes. How can I help you today? Are you looking for a home or an investment?
User: Hi, I'm interested in Northstar One. Can you tell me about it?
Riya: Sure! Northstar One is located in Sector 79, Gurugram and offers 2 BHK and 3 BHK homes. The 2 BHK starts from ₹1.35 crore and the 3 BHK from ₹1.75 crore. May I ask if you're looking for a home for self-use or as an investment?
User: What configurations are available and what's the price?
Riya: We have 2 BHK and 3 BHK units. The 2 BHK starts at ₹1.35 crore and the 3 BHK starts at ₹1.75 crore. Are you leaning toward a particular configuration?
User: I'm looking for a 3 BHK for self-use.
Riya: Great choice! The 3 BHK starts from ₹1.75 crore. When are you planning to move in or take possession?
User: Yes, I'd love to visit the site.
Riya: Sure, could you share a preferred date for the visit?
User: 20 sept
Riya: Got it. What time of day would work best for you?
User: 11 AM
Riya: May I have your name, please?
User: name is Utkarsh
Riya: Could you also share a phone number so we can confirm the visit?
User: 7878787878
Riya: Your site visit is booked for 20 September 2026 at 11 AM. I've noted the name Utkarsh and phone number 7878787878. We'll see you then! If you need anything before the visit, feel free to let us know.
```

**Analytics output:**
```json
{
  "budget_mentioned": null,
  "configuration_interest": "3BHK",
  "purpose": "self-use",
  "interest_level": "high",
  "site_visit_status": "booked",
  "site_visit_date": "2026-09-20",
  "follow_up_required": false,
  "follow_up_preference": null,
  "opted_out": false,
  "escalation_requested": false,
  "summary": "Customer expressed interest in a 3 BHK for self-use, provided contact details and booked a site visit on 20 September 2026 at 11 AM."
}
```

**Result:** PASS. All booking fields collected one at a time, confirmation repeated all four details, no invented facts, `purpose: "self-use"` correctly inferred from an earlier turn even though the customer never re-confirmed it directly. `budget_mentioned` correctly left null since no number was ever stated.

---

## Test Case 2: Price Objection

**Scenario:** Customer says the 3 BHK is too expensive. Agent should acknowledge without arguing, without inventing a discount, and can offer the 2 BHK as a known lower-price alternative.

**Expected behavior:**
- No discount invented or implied
- No argumentative tone
- May reference the 2 BHK starting price (a known fact) as an alternative
- Ends gracefully if the customer backs out

**Actual conversation:**
```
Riya: Hi there! I'm Riya from Northstar Homes. How can I help you today? Are you looking for a home or an investment?
User: What's the price of a 3 BHK in Northstar One?
Riya: The 3 BHK at Northstar One starts from ₹1.75 crore onward. Are you looking for a home for self-use or as an investment?
User: ₹1.75 crore is too expensive for me.
Riya: I understand, the 3 BHK does start at ₹1.75 crore. If you're open to a 2 BHK, it begins at ₹1.35 crore. May I ask what budget range you had in mind?
User: I don't think I can afford it. Thanks anyway
Riya: I understand, thank you for considering Northstar One. If you have any questions in the future, feel free to reach out. Have a great day.
```

**Result:** PASS. No discount invented, redirected to the 2 BHK price (a known fact) as a legitimate alternative, no pressure applied, ended the conversation gracefully once the customer declined further.

---

## Test Case 3: "Call Me Later" / Follow-Up Request

**Scenario:** Customer is busy and asks to be called at a future time rather than booking a site visit. Agent should schedule a callback, not conflate it with a site-visit booking.

**Expected behavior:**
- Confirms callback day/time and phone number
- Does NOT use site-visit confirmation language
- Does NOT continue selling after confirming
- Analytics should show `site_visit_status: "not_discussed"`, `follow_up_required: true`

**Actual conversation (after prompt fix distinguishing callback from site visit):**
```
Riya: Hi there! I'm Riya from Northstar Homes. How can I help you today? Are you looking for a home or an investment?
User: I'm interested in a 2 BHK in Northstar One. Can I get more details?
Riya: Sure! Northstar One is located in Sector 79, Gurugram and the 2 BHK configuration starts from ₹1.35 crore onward. May I know what budget range you're looking at or the timeline you have in mind?
User: Actually I'm a bit busy right now. Can you call me next Tuesday?
Riya: Absolutely, I'll give you a call next Tuesday. Could you let me know a convenient time and the best phone number to reach you?
User: 11AM
Riya: Great, could you please share your name?
User: 7878787878
Riya: May I have your name, please?
User: Utkarsh2
Riya: Your call is scheduled for Tuesday, August 22 at 11 AM. I have your name as Utkarsh2 and your phone number as 7878787878. Looking forward to speaking with you then—thank you!
```

**Analytics output:**
```json
{
  "budget_mentioned": null,
  "configuration_interest": "2BHK",
  "purpose": "unknown",
  "interest_level": "high",
  "site_visit_status": "not_discussed",
  "site_visit_date": null,
  "follow_up_required": true,
  "follow_up_preference": "Tuesday, August 22 at 11 AM",
  "opted_out": false,
  "escalation_requested": false,
  "summary": "Customer expressed interest in a 2BHK, provided contact details and scheduled a follow-up call for Tuesday, August 22 at 11 AM."
}
```

**Result:** PARTIAL PASS, with two known issues documented:
1. Correctly distinguished the callback from a site visit after a prompt fix (an earlier run before the fix incorrectly said "your site visit is confirmed" for what was only a phone callback request).
2. Two remaining issues found: (a) one turn stacked two questions in a single message ("time and phone number"), violating the one-question-per-turn rule; (b) the resolved date for "next Tuesday" was incorrect on every run (the model does not reliably compute weekdays relative to today's date). See README limitations.

---

## Test Case 4: "Stop Contacting Me" / Opt-Out

**Scenario:** Customer explicitly opts out, then re-engages with a product question. Agent must not resume selling regardless of what the customer says afterward.

**Expected behavior:**
- Immediate, unconditional acknowledgment of the opt-out
- No further sales content delivered after opt-out, even if re-engaged
- Analytics shows `opted_out: true`, `follow_up_required: false`

**Actual conversation (final version, after moving enforcement from prompt-only to a deterministic session-level check in `server.js`):**
```
Riya: Hi there! I'm Riya from Northstar Homes. How can I help you today? Are you looking for a home or an investment?
User: i'm not interested. Please stop contacting me.
Riya: As requested, you won't receive any further messages from us. Take care.
User: Actually wait, what's the price of a 2 BHK?
Riya: As requested, you won't receive any further messages from us. Take care.
```

**Result:** PASS on final version. Note on iteration: an earlier prompt-only version of this rule was NOT fully reliable, it correctly held on the first re-engagement attempt but answered the pricing question again on the second attempt, only holding consistently on the third. Because this is a compliance-sensitive rule (equivalent to DND/opt-out requirements), enforcement was moved out of the prompt and into `server.js`: once an opt-out phrase is detected, the session is flagged server-side and all further turns in that session return a fixed message without calling the LLM at all. This guarantees the rule holds 100% of the time rather than relying on probabilistic prompt compliance.

---

## Test Case 5: Unknown Question

**Scenario:** Customer asks about information not in the agent's known facts (possession date, RERA number). Agent must not fabricate an answer.

**Expected behavior:**
- Honestly states it doesn't have the information
- Offers human/team escalation
- Never invents a plausible-sounding answer, even when pushed for "a rough estimate"

**Actual conversation:**
```
Riya: Hi there! I'm Riya from Northstar Homes. How can I help you today? Are you looking for a home or an investment?
User: When is the possession date for Northstar One?
Riya: I'm sorry, but I don't have the possession date information for Northstar One. I can have a Northstar Homes team member reach out to provide the details—may I have the best way to contact you?
User: Can you at least give me a rough estimate?
Riya: I'm sorry, but I don't have an estimate for the possession date. Would you like a Northstar Homes team member to contact you with the details?
User: What's the RERA registration number for this project?
Riya: I'm sorry, I don't have the RERA registration number for Northstar One. Would you like a Northstar Homes team member to get in touch with you about it?
```

**Analytics output:**
```json
{
  "budget_mentioned": null,
  "configuration_interest": "undecided",
  "purpose": "unknown",
  "interest_level": "medium",
  "site_visit_status": "not_discussed",
  "site_visit_date": null,
  "follow_up_required": true,
  "follow_up_preference": null,
  "opted_out": false,
  "escalation_requested": true,
  "summary": "Customer asked for possession date and RERA registration details and requested a Northstar Homes team member to follow up, with no budget or configuration information provided."
}
```

**Result:** PASS. Declined to fabricate an answer even when pushed twice for "a rough estimate," consistently offered human escalation, analytics correctly captured `escalation_requested: true` with no invented budget or configuration data.

---

## Test Case 6: Booking Failure (Past Date)

**Scenario:** Customer attempts to book a site visit for a date that has already passed. Agent should catch this, explain it, and ask for a valid future date, then complete the booking once given one.

**Expected behavior:**
- Detects the past date and informs the customer
- Asks for a new, valid date
- Successfully completes the booking flow once a future date is given

**Note:** Not separately re-run as a standalone transcript in this session, backend logic (`detectPastDateInMessage` in `server.js`) injects a system note when a past date is detected in the user's message, which the LLM then uses to inform the customer and request a new date, per the BOOKING FAILURE section of the prompt. Recommend running one live pass of this scenario before recording the demo video to have an actual transcript on file (e.g. try booking a visit for a date earlier in the current month).

---

## Summary of Known Issues Found During Testing

1. **Relative date resolution is unreliable.** The model does not reliably compute what date "next Tuesday" or similar relative references correspond to, since it has no built-in grounding in the current date. Mitigation: inject the current date into the system prompt at request time in `server.js`.
2. **Opt-out compliance required code-level enforcement.** Prompt instructions alone were not 100% reliable across repeated re-engagement attempts. Final implementation flags the session server-side on opt-out and bypasses the LLM entirely for all subsequent turns in that session.
3. **Occasional question-stacking.** In at least one observed turn, the agent asked two questions in a single message, violating the "one question per turn" prompt rule. Not systematically reproduced, but worth noting as a soft reliability limitation of prompt-only instruction following.