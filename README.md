# The Lead Machine

From Joe Che's AI class. A small system that finds you real leads who fit
your business, and never repeats a name. It never sends anything. You read
every result and reach out yourself.

Version: 2.1.0 (see VERSION). Updates: https://github.com/josephtandle/lead-machine

## The two ways to run it

**Way 1, most people.** Open `PASTE-INTO-CHATGPT-OR-CLAUDE.txt`, select all,
paste it into ChatGPT or Claude in your browser, and send. No install for this
kit, about 2 minutes, and an existing ChatGPT or Claude account is required.
It runs the same cold outreach described below, right there in the chat.

**Way 2, Claude Code, Codex, or Gemini CLI.** Open this whole folder in that
tool and say "go". It remembers your business and every lead you have been
shown across days, so "more" never repeats a name, and you never answer the
same setup question twice.

## What the modes do

**It asks one thing first:** cold outreach, warm network, or both. Cold runs first whenever there is any doubt.

**Cold outreach (the default).** Figures out what you sell and who you serve from
this folder if it can, otherwise asks you exactly one question. You can answer in words or just paste your website link. Then finds you
25 real people or businesses who fit, each with a public way to reach them,
and shows them as a plain numbered list. Say "more" any time for a fresh 25.

**Warm network (pick it at the start, or say "warm" any time).** Connects to your own LinkedIn and
inbox through your browser, so it can work from people you already have a
real connection with: your connections, the people who comment on your posts,
the people who reply to you. It finds the ones who have shown, in their own
words, that they have the problem you solve, screens out clients, family, and
anyone you already messaged, and drafts one short personal message per person
in your voice. You approve each one by number, then copy and send it yourself.

## The three rules

1. Nobody appears without proof. In cold outreach, that means a real public
   contact route the business itself put up. In warm network, that means a
   quoted line showing they have the problem you solve.
2. Never message clients, family, or close friends. In warm network, that
   list lives in `data/do-not-contact.csv`, yours to fill; when unsure, the
   system drops the person.
3. Never send a message that has not been read and approved word for word.
   This system has no send capability. You always send it yourself.

## Daily limits (warm network)

LinkedIn: 20 to 25 new people a day, spread out. WhatsApp: small batches, only
people who already have your number or messaged you first. Instagram: a
handful a day. These caps hold even if you push back on them.

## Files in this folder

- `START-HERE.txt`, read this first.
- `PASTE-INTO-CHATGPT-OR-CLAUDE.txt`, the browser version of cold outreach.
- `CLAUDE.md`, the full spec the folder version loads and follows.
- `AGENTS.md`, the entry point for Codex and Gemini CLI.
- `.claude/commands/`, one instruction file per command (leads, advanced,
  setup, hunt, screen, draft).
- `scripts/find-leads.mjs`, the tool that does the public-web search for easy
  mode leads.
- `templates/`, empty CSVs that get copied into `data/` on first setup.
- `MY-BUSINESS.md`, created in this folder when the tool learns your business.
- `data/`, where found leads and warm-network files (candidates, screened,
  queue, already-messaged) get written. This folder is yours; nothing in it is
  shared anywhere.
- `VERSION`, the current version number of this kit.

## What a run looks like

This is one real cycle, invented names throughout.

> **You:** go
> **It:** Going with: you sell 8-week breathwork coaching to burned-out
> founders, mostly US and UK. Say 'change' if that's off.
> Found 25, here they are:
> 1. Aiden Cross, founder coach at Cross Peak Consulting, works with exhausted
>    startup founders, contact: hello@crosspeakconsulting.com
> 2. Marla Vance, wellness studio owner in Austin, runs burnout workshops for
>    small teams, contact: marlavance.com/contact
> ...23 more...
> That is 25. Say 'more' for a fresh 25, no repeats. There's also an advanced
> mode that works from your own LinkedIn and inbox. Say 'advanced' any time.

> **You:** more
> **It:** Found 25 more, no repeats from last time: ...

> **You:** advanced
> **It:** Explains the three lines, asks yes or no, then walks through
> connecting your browser one step at a time.

## Troubleshooting

**"Node is missing" or the script will not run.** The folder version can guide
you to install Node (brew on a Mac, winget on Windows, or nodejs.org), then
retry the command. Review and run any installer command yourself.

**Fewer than 25 came back.** It will automatically try a few reworded
searches before showing you the list. If it still comes up short, it will say
so and tell you why, rather than pad the list with weak fits.

**"It asked me a question."** That only happens when it genuinely cannot tell
what you sell or who you serve from this folder or the conversation. Answer
it once and it will never ask again.

**I want to change my business description.** Either edit `MY-BUSINESS.md`
directly in this folder, or just say "change" and give the new one-liner.
