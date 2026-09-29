# The Lead Machine (Codex / Gemini CLI / other agents)

If you are reading this file, you are probably Codex, Gemini CLI, or another AI coding agent. The full spec is in `CLAUDE.md` in this folder, and every rule in it is binding on you exactly as written, especially: nothing is ever sent by this system, and easy mode never asks more than one question.

This folder's commands live in `.claude/commands/` as plain instruction files, not real slash commands. When the person uses plain words, read the matching file and follow it:

- "go", "leads", or "more" -> `.claude/commands/leads.md`
- "advanced" -> `.claude/commands/advanced.md`
- "set me up" -> `.claude/commands/setup.md`
- "hunt N" (any number) -> `.claude/commands/hunt.md`
- "screen" -> `.claude/commands/screen.md`
- "draft" -> `.claude/commands/draft.md`

Start with `.claude/commands/leads.md` on the very first open of this folder, unless the person says something else first.
