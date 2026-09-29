Refuse to run unless data/screened.csv exists and is newer than
data/candidates.csv.

For each person in data/screened.csv write ONE first-touch message in this
person's voice (rules and samples: CLAUDE.md + MY-BUSINESS.md). First line
about THEM, built on their intent quote. No pitch, no price, no links, no
filler, no em dashes.

Write data/queue.csv with:
n,name,channel,handle,draft,intent_quote,status   (status = pending)

Then show the numbered queue: n, name, channel, quote, draft. Reply with
numbers to approve, edit, or kill. After ANY edit, re-show the final text
before counting it approved.

Append approved people to data/already-messaged.csv with today's date.

State the daily caps and remind them everything is sent by hand, by them,
never by this system.
