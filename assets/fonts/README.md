# Fonts for the generated cards

These are here for `lib/og.tsx` and nothing else. Satori — the renderer behind
`next/og` — needs real font data; it cannot use a CSS stack, and none of the
app's three families (`--font-serif` is Palatino/Georgia, a system stack) exist
as files anywhere. Without these, a card renders in whatever Satori falls back
to, which is not this app's voice.

| File | Stands in for | Used for |
| --- | --- | --- |
| `EBGaramond-Regular.ttf` | the `--font-serif` Palatino stack | card body |
| `EBGaramond-SemiBold.ttf` | " | — |
| `EBGaramond-Italic.ttf` | " | the round name, set italic like every title in the app |
| `JetBrainsMono-Medium.ttf` | `--font-mono` | eyebrows, the entry-code plate, the meta line |

EB Garamond and JetBrains Mono are both under the
[SIL Open Font License 1.1](https://openfontlicense.org), which permits
bundling and redistribution. Fetched from Google Fonts as TrueType —
**not WOFF2, which Satori cannot read.**

Note this means the cards and the app do not render in the same typeface: the
app asks for Palatino and gets Georgia or worse depending on the machine, while
the cards always get Garamond. Wiring the same webfont through `next/font`
would settle that, but it changes every screen and deserves its own decision.
