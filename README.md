# dino-saurus-space-attorney-at-claw

Dino Saurus: Space Attorney at Claw is a black-and-white retro courtroom visual
novel inspired by NES/SNES games. Play a dinosaur defense attorney, press
witnesses, present evidence, and choose the right objection to expose lies and
prove your client innocent in a cosmic court system.

## M0 — The Micro-Prototype

A five-minute, hardcoded courtroom micro-case ("MICRO-CASE 0-0: THE MISSING
LUNCH") that exists to answer one question: **is diagnosing objection categories
fun?** Vite + vanilla TypeScript, no framework, no runtime dependencies.

### Run

```bash
npm install
npm run dev      # dev server
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build
```

Then open the printed URL. Works on desktop and phone browsers.

### Presentation

- Logical canvas **256×224**, integer-scaled to the largest multiple that fits,
  centered on black, nearest-neighbor (`image-rendering: pixelated`).
- Exactly **four colors** ever appear: `#000000 #707070 #C8C8C8 #FFFFFF`. Every
  pixel is written into a framebuffer in one of those four values — no alpha, no
  anti-aliasing. Press **P** to dump a palette census to the console.
- Custom 5×7 bitmap font (monospace, bold, all-caps, letter-spaced) so text is
  crisp and palette-safe.
- All sound (typewriter blips, menu thud, OBJECTION! sting, wrong-answer buzz) is
  synthesized in code with the Web Audio API — no audio files.

### Controls

| Key | Action |
| --- | --- |
| Arrows | Navigate menus / cycle statements |
| Z / Enter / Space | Confirm, press witness, advance text |
| X / Backspace | Objection / back / cancel |
| C | Evidence overlay |
| P | Debug: palette census to console |

Every menu row and on-screen button is also a click/tap target.

### Game flow

`TITLE → INTRO → TESTIMONY → (PRESS / OBJECTION / EVIDENCE) → BREAKDOWN → VERDICT`

- **Pressing is free** — it never costs POWER.
- A **wrong objection** (or objecting an unobjectionable statement) costs 1 of 5
  POWER pips and triggers the judge's rebuke.
- The **correct objection** triggers a witness BREAKDOWN. Breaking the first lie
  reveals a follow-up statement; breaking the second ends the case.
- **POWER empty** offers RESTART TESTIMONY (no hard fail). A clean run (zero POWER
  lost) earns **CASE RANK: S**; otherwise a letter grade by pips remaining.

### Optional portraits

Drop 96×96 PNGs into `public/assets/portraits/` (`dino_saurus.png`, `pterax.png`,
`judge.png`) to replace the built-in placeholders. Missing files fall back to a
generated placeholder, so the game is fully playable with zero assets present.

### Where the content lives

All case text and logic data lives in a single `MICRO_CASE` const in
[`src/case.ts`](src/case.ts); the state machine reads only from it, so a later
milestone can extract a schema from exactly that shape.
