import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og.js";
import sharp from "sharp";

/**
 * The lockups: the glass on the left, the name set beside it.
 *
 * Six masters into `public/brand/`, all PNG because the mark is artwork
 * rather than code (see CLAUDE.md — there is no vector source to draw from):
 *
 *   lockup-cream.png        transparent · dark ink    · for cream/light grounds
 *   lockup-dark.png         transparent · cream ink   · for the Midnight ground
 *   lockup-cream-stock.png  flattened on cream stock, margins on
 *   lockup-dark-stock.png   flattened on Midnight felt, margins on
 *   letterhead-cream.png    stock + the tagline in italic beneath
 *   letterhead-dark.png     felt  + the tagline in italic beneath
 *
 * The wordmark is the sign-in masthead's voice verbatim — serif, uppercase,
 * tracked 0.08em, foreground ink — because that screen is the app's own
 * lockup and two voices for one name is a brand with a stutter. Type is
 * drawn by Satori (the same renderer as lib/og.tsx) from the vendored
 * EB Garamond, so the letterforms here are the letterforms every OG card
 * already prints; sharp then trims and flattens, `.ensureAlpha()` included,
 * for the same reason the icon pipeline demands it.
 *
 * Run from the repo root:  node scripts/brand-lockups.mjs
 */

const ROOT = process.cwd();
const BRAND = join(ROOT, "public/brand");

/** Hand-kept mirror of the two grounds in app/globals.css — cream stock
 * (`:root`) and the Midnight Invitational (`.dark`). Update together. */
const GROUNDS = {
  cream: { stock: "#f1edde", ink: "#23281e", muted: "#5a5f4e" },
  dark: { stock: "#101b13", ink: "#eae5d2", muted: "#a8ad93" },
};

const TAGLINE = "Nine pubs. Par 36. Lowest swigs wins.";

// ---------------------------------------------------------------------------
// Geometry. One number rules them all: MARK is the glass's box, and the
// wordmark, gap and margins are set from it so the lockup rescales as a
// piece. The type size makes the caps sit level with the glass body rather
// than the flag — the flag is a gesture, not the mass.
// ---------------------------------------------------------------------------
const MARK = 640;
// Garamond's cap height runs ≈ 0.7em, and the caps read level beside the
// glass at about 0.39 of its height — so the em size is that ratio undone.
const WORD_SIZE = Math.round((MARK * 0.39) / 0.7);
const GAP = Math.round(MARK * 0.2);
const TRACKING = 0.08; // em — the masthead's tracking-[0.08em]
const CANVAS = { width: MARK * 6, height: MARK * 2 };

async function fonts() {
  const [regular, italic] = await Promise.all([
    readFile(join(ROOT, "assets/fonts/EBGaramond-Regular.ttf")),
    readFile(join(ROOT, "assets/fonts/EBGaramond-Italic.ttf")),
  ]);
  return [
    { name: "Garamond", data: regular, style: "normal", weight: 400 },
    { name: "Garamond", data: italic, style: "italic", weight: 400 },
  ];
}

/**
 * The mark, trimmed to its ink and sized to the lockup's box.
 *
 * The master files carry breathing room inside their own canvas, which is
 * right for an icon slot and wrong here: an invisible margin between glass
 * and wordmark would double the gap the geometry asked for. Trim first, so
 * GAP means what it says, and carry the true aspect so nothing stretches.
 */
async function markFor(file) {
  const trimmed = await sharp(join(BRAND, file)).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  return {
    uri: `data:image/png;base64,${trimmed.toString("base64")}`,
    width: Math.round((meta.width / meta.height) * MARK),
    height: MARK,
  };
}

/** Satori element helpers — this is a script, so no JSX. */
const el = (type, style, children) => ({ type, props: { style, children } });

function wordmark(ink) {
  return el(
    "div",
    {
      fontFamily: "Garamond",
      fontSize: WORD_SIZE,
      color: ink,
      textTransform: "uppercase",
      letterSpacing: `${TRACKING}em`,
      whiteSpace: "nowrap",
      // Garamond's caps float a whisker high of the glass's optical middle;
      // this nudge is the difference between measured and level.
      marginTop: Math.round(MARK * 0.02),
    },
    "Pub Golf",
  );
}

function lockupRow(mark, ink) {
  return el("div", { display: "flex", alignItems: "center" }, [
    {
      type: "img",
      props: {
        src: mark.uri,
        width: mark.width,
        height: mark.height,
        style: {},
      },
    },
    el("div", { display: "flex", marginLeft: GAP }, [wordmark(ink)]),
  ]);
}

function letterheadColumn(mark, ground) {
  return el(
    "div",
    { display: "flex", flexDirection: "column", alignItems: "center" },
    [
      lockupRow(mark, ground.ink),
      el(
        "div",
        {
          fontFamily: "Garamond",
          fontStyle: "italic",
          fontSize: Math.round(WORD_SIZE * 0.34),
          color: ground.muted,
          marginTop: Math.round(MARK * 0.14),
          whiteSpace: "nowrap",
        },
        TAGLINE,
      ),
    ],
  );
}

/** Render an element on a transparent oversize canvas, then trim to ink. */
async function renderTrimmed(element, fontList) {
  const response = new ImageResponse(
    el(
      "div",
      {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
      [element],
    ),
    { ...CANVAS, fonts: fontList },
  );
  const png = Buffer.from(await response.arrayBuffer());
  return sharp(png).trim().png().toBuffer();
}

/** Flatten a trimmed lockup onto its ground with margins scaled to the mark. */
async function onStock(trimmed, stock) {
  const margin = Math.round(MARK * 0.28);
  return sharp(trimmed)
    .extend({
      top: margin,
      bottom: margin,
      left: margin,
      right: margin,
      background: stock,
    })
    .flatten({ background: stock })
    .ensureAlpha()
    .png()
    .toBuffer();
}

async function writeOut(name, buffer) {
  const path = join(BRAND, name);
  await sharp(buffer).png().toFile(path);
  const meta = await sharp(path).metadata();
  console.log(
    `  ${name.padEnd(24)} ${meta.width}×${meta.height} ${meta.hasAlpha ? "alpha" : "no-alpha"}`,
  );
}

const fontList = await fonts();

for (const [groundName, ground] of Object.entries(GROUNDS)) {
  // mark-cream is inked dark FOR cream stock; mark-dark is inked light FOR
  // the Midnight ground — the file names describe the paper, not the ink.
  const mark = await markFor(`mark-${groundName}.png`);

  const lockup = await renderTrimmed(lockupRow(mark, ground.ink), fontList);
  await writeOut(`lockup-${groundName}.png`, lockup);
  await writeOut(`lockup-${groundName}-stock.png`, await onStock(lockup, ground.stock));

  const letterhead = await renderTrimmed(
    letterheadColumn(mark, ground),
    fontList,
  );
  await writeOut(
    `letterhead-${groundName}.png`,
    await onStock(letterhead, ground.stock),
  );
}

console.log("Lockups written to public/brand/");
