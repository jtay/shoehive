// Replaced at build time by tsup (see tsup.config.ts). Unset when running from source.
declare const __SHOEHIVE_VERSION__: string | undefined;
declare const __CREATE_SHOEHIVE_VERSION__: string | undefined;

/** The shoehive version this scaffolder was built with, or `null` when running from source. */
export const SHOEHIVE_VERSION: string | null =
  typeof __SHOEHIVE_VERSION__ === 'string' ? __SHOEHIVE_VERSION__ : null;

export const CREATE_SHOEHIVE_VERSION: string =
  typeof __CREATE_SHOEHIVE_VERSION__ === 'string' ? __CREATE_SHOEHIVE_VERSION__ : '0.0.0-source';

/**
 * The default spec for the generated project's `shoehive` dependency: a caret range on the
 * version we were built with (`^1.2.0`, or `^1.0.0-next.3` during prereleases, which also
 * matches later prereleases and the final release). `latest` when running from source.
 */
export function defaultShoehiveSpec(version: string | null = SHOEHIVE_VERSION): string {
  return version === null ? 'latest' : `^${version}`;
}
