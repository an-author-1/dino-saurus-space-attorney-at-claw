# DINO SAURUS — SPACE ATTORNEY AT CLAW

Dino Saurus: Space Attorney at Claw is a black-and-white retro courtroom visual
novel inspired by NES/SNES games. Play a dinosaur defense attorney, press
witnesses, present evidence, and choose the right objection to expose lies and
prove your client innocent in a cosmic court system.

---

## M0: the micro-prototype

This repo currently contains **M0** — a five-minute, hardcoded courtroom scene
that exists to answer one question: *is diagnosing objection categories fun?*

Read the witness's testimony, **press** statements for flavor (free), and
**object** with the right category — using evidence where a contradiction
demands it — to break each lie and win an acquittal.

### Run it

```bash
npm install
npm run dev      # dev server (Vite) — open the printed localhost URL
npm run build    # typecheck (tsc) + production build into dist/
npm run preview  # serve the production build
```

No asset files are required — the game ships with zero assets and draws
procedural placeholder portraits. (If you drop 96×96 PNGs at
`public/assets/portraits/{dino_saurus,pterax,judge}.png`, they'll be used
automatically.)

### Controls

| Key | Action | Touch |
| --- | --- | --- |
| ◀ ▶ arrows | cycle statements / move menu cursor | tap the on-screen arrows / rows |
| **Z** / Enter / Space | confirm · press · advance text | tap the `[Z] PRESS` button / any row |
| **X** / Esc | object · back / cancel | tap `[X] OBJECT` |
| **C** | evidence overlay (Court Record) | tap `[C] EVID` |
| **P** | dump a palette census to the console (debug) | — |

Every menu row and button is also a click/tap target — the game is designed to
be played on a phone.

### Presentation constraints (M0 rules)

- Logical canvas **256×224**, integer-scaled with nearest-neighbor, centered on
  black.
- **Exactly four colors** ever reach the screen: `#000000`, `#707070`,
  `#C8C8C8`, `#FFFFFF`. A per-frame post-pass snaps every pixel to the nearest
  of the four (press **P** to audit the current frame).
- Monospace bold, all-caps, letter-spaced type with a ~30 cps typewriter reveal
  (skippable with confirm).
- All sound is synthesized in code via Web Audio — no audio files.

### Where the content lives

Every line the player reads lives in a single const, `MICRO_CASE`, in
[`src/case.ts`](src/case.ts). The state machine in
[`src/game.ts`](src/game.ts) reads *only* from that const and contains no case
text of its own — a later milestone will extract a schema from exactly this
shape.

### Source map

| File | Role |
| --- | --- |
| `src/case.ts` | `MICRO_CASE` — the entire hardcoded case (the extractable const) |
| `src/game.ts` | the `TITLE→INTRO→TESTIMONY→…→VERDICT` state machine + rendering |
| `src/gfx.ts` | framebuffer helpers: palette snap/census, text, boxes, header tab |
| `src/audio.ts` | Web Audio blips, thud, OBJECTION sting, wrong-answer buzz |
| `src/portraits.ts` | portrait loader + procedural four-color placeholders |
| `src/main.ts` | bootstrap: scaling, input, the render loop |
