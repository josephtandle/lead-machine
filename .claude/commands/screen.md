Take data/candidates.csv and apply every HARD screening rule in CLAUDE.md:
drop anyone in data/my-clients.csv, data/do-not-contact.csv, or
data/already-messaged.csv (match name, handle, email, phone, case-insensitive),
and drop anyone who cannot be checked.

Write survivors to data/screened.csv with a pass_reason column stating what
was checked.

Report counts only: in, out, dropped per rule. Then state that the next step
is draft.
