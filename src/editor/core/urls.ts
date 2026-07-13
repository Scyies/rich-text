const SAFE_LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/**
 * Returns a normalized link target when it is safe to place in an href.
 * Relative and protocol-relative links are allowed; executable/data schemes
 * and control-character obfuscation are rejected.
 */
export function sanitizeLinkHref(href: string): string | null {
  const normalized = href.trim();
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (normalized.length === 0 || hasControlCharacter) {
    return null;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)?.[1]?.toLowerCase();
  return scheme === undefined || SAFE_LINK_SCHEMES.has(scheme) ? normalized : null;
}

export function isSafeLinkHref(href: string): boolean {
  return sanitizeLinkHref(href) !== null;
}
