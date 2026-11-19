# Code blocks with colors and a copy button

## What you'll see
- Code in Capri's replies (Python, JavaScript, Bash, HTML, SQL...) shows with syntax colors that match the dark Capri theme.
- Each block has a header with the language name and a "Copy" button that confirms when copied.
- Long lines scroll sideways inside the block on mobile, without stretching the page.
- Shared links show the same colored code.

## Technical details
- The reply renderer already includes the code-highlighting plugin, but its styles are not being picked up: `src/styles.css` uses `source(none)` and only scans `../src`. Add `@source` lines for `node_modules/streamdown/dist` and `node_modules/@streamdown/code/dist` so its classes are generated.
- Force the dark highlighting theme (Capri has no light mode) via Streamdown `shikiTheme` props in `MessageResponse`.
- Add small CSS tweaks in `styles.css` using theme tokens (block background `--card`, border, rounded corners, horizontal scroll, larger copy button tap target on mobile).
- Verify with Playwright at 384px width on a reply containing a code block: colors visible, copy button works.
