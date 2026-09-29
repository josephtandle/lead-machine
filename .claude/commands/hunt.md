Find $ARGUMENTS people never contacted before who plausibly need what this
person sells (see MY-BUSINESS.md). Only run this in advanced mode, after setup.

Sources, in order of value:
1. data/Connections.csv (their LinkedIn export), people whose title or company
   fits the best customer.
2. Anything pasted or pointed to: comments on their posts, replies in their
   inbox, community threads.
3. If advanced mode is connected through a browser tool, their own LinkedIn
   connections, post comments, and inbox replies read directly through that
   connection.
4. People named from memory, ask for the evidence line before including them.

For each person, capture a QUOTED line that shows they have the problem this
person solves, and where it is from. No quote, not on the list.

Write data/candidates.csv with:
name,channel,handle,email,business,intent_quote,quote_source,notes

Do not screen or draft yet. End by stating the count and the daily caps.
