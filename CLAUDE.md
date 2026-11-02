# CLAUDE.md

[AGENTS.md](AGENTS.md) is the source of truth for conventions. Summary:

- Build-free static PWA; relative URLs only; no frameworks or bundlers.
- Classic scripts with global functions and inline handlers; keep the script order in `index.html`.
- Two-space indentation and semicolons.
- AI calls only through `supabase/functions/brain`; never ship a key to the browser.
- Run `npm test` before finishing.
