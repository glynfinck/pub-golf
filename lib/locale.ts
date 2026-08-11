/**
 * The player's first choice from an Accept-Language header, as a BCP-47 tag
 * the Places APIs accept ("en-GB", "pt-BR"). Highest q wins, ties keep
 * header order; wildcards and malformed entries lose. Null when nothing
 * usable — the caller omits the field and Google falls back to its own
 * default.
 */
export function primaryLanguage(header: string | null): string | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((entry, index) => {
      const [tag = "", ...params] = entry.trim().split(";");
      const qParam = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter(
      ({ tag, q }) => q > 0 && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(tag),
    );
  if (tags.length === 0) return null;
  tags.sort((a, b) => b.q - a.q || a.index - b.index);
  return tags[0].tag;
}
