<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Chat streaming lives in the `/api/chat` server route (`src/lib/chat.server.ts`), which verifies the caller's bearer token and the thread's owner before calling the AI Gateway; thread pages live under `src/routes/_authenticated/chat.*` so every conversation has its own URL.
- Capri's system prompt is composed in `src/lib/instructions.ts` (base personality + one custom block: the thread's instructions, else the project's instructions when the thread belongs to a project, else the account default from `user_settings`); keep the precedence rule there so the server route and its tests share it.
- Deep search runs in the `public.search_messages(q)` SQL function (SECURITY INVOKER, so RLS keeps it per-user) and is called from `src/lib/search.ts`; matching ignores case and accents on both sides (`unaccent` in SQL, `foldText` in the client highlighter), and the minimum query length must stay in sync between them.
