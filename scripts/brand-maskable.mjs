import sharp from "sharp";
import { join } from "node:path";

/**
 * The maskable install icon.
 *
 * Android does not install the icon you give it — it masks the icon into
 * whatever shape the launcher uses (circle, squircle, teardrop, rounded
 * square, and the OEMs keep inventing more). An icon that does not declare
 * `purpose: "maskable"` gets letterboxed instead: the whole squircle plate
 * shrunk inside the launcher's shape, a badge floating on a background it
 * did not choose. Two frames arguing, which is the same thing the sign-in
 * screen stopped doing when the ring came off the mark.
 *
 * So this writes the one plate the spec actually wants: colour to every
 * edge, and the artwork small enough to survive the crop. The safe zone is
 * the central circle of 80% diameter — anything outside it may be cut — and
 * the plate is scaled to 70% of the canvas so the glass sits comfortably
 * inside that circle rather than exactly on it.
 *
 * The ground is sampled from the master rather than taken from
 * `app/globals.css`: the mark is artwork, its plate is very slightly warmer
 * than the Midnight token, and the squircle has to vanish into the fill or
 * its corners show as a seam. `.ensureAlpha()` for the reason CLAUDE.md
 * gives — Next's ICO decoder and sips both punish an RGB PNG.
 *
 * Run from the repo root:  node scripts/brand-maskable.mjs
 */

const BRAND = join(process.cwd(), "public/brand");
const SIZE = 512;
/** Share of the canvas the squircle plate is allowed to fill. */
const INSET = 0.7;

/** The plate's own ink, read off the master so the seam cannot show. */
async function plateGround(master) {
  const { data, info } = await sharp(master)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Top-centre: inside the squircle on every master, and clear of the glass.
  const index = Math.floor(info.width / 2) * info.channels +
    Math.floor(info.height * 0.02) * info.width * info.channels;
  return { r: data[index], g: data[index + 1], b: data[index + 2], alpha: 1 };
}

const master = join(BRAND, "icon-dark.png");
const inner = Math.round(SIZE * INSET);

const plate = await sharp(master)
  .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

const out = join(BRAND, "icon-maskable-512.png");
await sharp({
  create: {
    width: SIZE,
    height: SIZE,
    channels: 4,
    background: await plateGround(master),
  },
})
  .composite([{ input: plate, gravity: "centre" }])
  .ensureAlpha()
  .png()
  .toFile(out);

console.log(`wrote ${out} — ${SIZE}px, plate at ${INSET * 100}%`);
