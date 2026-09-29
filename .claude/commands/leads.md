Easy mode. Target count: $ARGUMENTS (default 25 if not given).

STEP 0: Check what you already know before asking anything.
Read MY-BUSINESS.md if it exists and skip to STEP 1. Otherwise look at this
folder and its parent for anything describing the business (README, about
page, website folder, brand docs, proposals, invoices, email signature), the
git config user name, and anything already said in this session or held in
memory. If that is enough to state WHAT THEY SELL and WHO THEY SERVE (and
roughly where), write MY-BUSINESS.md now, say "Going with: you sell X to Y in
Z. Say 'change' if that's off." and continue without waiting. If not, ask
exactly ONE question: "Who are your ideal clients, what do you sell them, and
roughly where are they? Or just paste your website link and I will work it
out." Wait for the answer. A pasted website, LinkedIn, or Instagram link
counts: fetch it, read what they sell and who they serve, state it back. A vague answer still counts:
make a stated best guess and move on. Write MY-BUSINESS.md either way.

STEP 1: Get the count.
Run: node scripts/find-leads.mjs --who "<target demographic from MY-BUSINESS.md>" --count <N> --exclude data/already-found.csv
If Node is missing, install it for the platform (brew, winget, or nodejs.org)
and retry. If short of <N>, rerun with 2-3 reworded/narrowed --who variants
until you reach <N> total, combining results with no repeats. If still short
and you have web search or fetch tools, top up the same way: only public
contact routes published on the business's own site, never a guessed email.

STEP 2: Show the list.
Show a numbered list: name, what they do, why they fit, how to reach them.
If and only if <N> leads were found, then: "That is <N>. Say 'more' for a fresh
<N>, no repeats." Add once, lightly:
"There's also an advanced mode that works from your own LinkedIn and inbox.
Say 'advanced' any time." Never push it again after saying it once. If fewer
than <N> were found after allowed retries, state the shortfall and why before
showing the partial list.
