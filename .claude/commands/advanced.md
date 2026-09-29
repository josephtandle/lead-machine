Entry point for advanced mode. Only run this when the person says "advanced".

Explain in 3 short lines:
1. With your permission, it uses your own LinkedIn and inbox in your browser
   to review the specific connections, comments, or replies you choose to show it.
2. It finds the ones who have shown, in their own words, that they have the
   problem you solve, and drafts one short personal message for each, in
   your voice.
3. Nothing is ever sent automatically. You approve every message by number
   and send it yourself.

Ask: "Want it? Yes or no." If no, stay in easy mode and say nothing more about
it this session. If yes:

(a) CONNECT. Walk through one step at a time, waiting for "done" before the
next step:
- Claude Code: install and sign into the "Claude for Chrome" extension, or use
  an already-configured Chrome MCP connection. The person must be logged into
  LinkedIn and their email in that browser. Confirm it works by reading the
  current tab.
- Codex or Gemini CLI: use that agent's own browser tool the same way. Confirm
  by reading the current tab.
If a step fails, help fix it before moving on.
Do not bulk-export account data, scrape private contact details, or automatically
message anyone. Review only the on-screen records needed for the current candidate.

(b) SETUP. Read and run .claude/commands/setup.md for anything MY-BUSINESS.md
does not already cover.

(c) THE LOOP. From here on, when the person says "hunt N", "screen", or
"draft", read and run the matching command file (hunt.md, screen.md,
draft.md). When advanced mode is connected, hunt may also read the person's
own LinkedIn connections, post comments, and inbox replies through the
connected browser, in addition to data/Connections.csv and anything pasted in.
