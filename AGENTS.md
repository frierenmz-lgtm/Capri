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
- Study mode lives in the `/api/study` server route (`src/lib/study.server.ts`: generates and saves a multiple-choice quiz from a project's text files or a free topic) with pages under `src/routes/_authenticated/estudio*` and tables `study_quizzes` + `study_questions`; quiz generation uses text files only.
- Capri's mascot is Kiri, Frieren's own character: `public/mascot.png` is the clean full-body front view cut from the base character sheet, and `public/kiri-<state>.png` (idle, success, confused, alert, sleep) are the UI states cut from the clean cutouts sheet; all are binary, so they go up through the GitHub web UI, the snapshot push is text-only. `src/components/mascot.tsx` renders the full body by default and a state as a circle when given `state`; home uses the full body, the new-chat empty state uses idle, study results use success, and the quiz-not-found screen uses confused. The 512px app icon from the pack (`kiri-icon-512.png`) is NOT wired in yet: ask Frieren before making Kiri the app icon.
- Capri's mascot is Frieren's own drawing, cropped to the character, at `public/mascot.png` (binary: upload it through the GitHub web UI, the snapshot push is text-only) and rendered by `src/components/mascot.tsx`; it appears on the home page, the new-chat empty state, and the study results screen.
