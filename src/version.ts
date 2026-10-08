import pkg from "../package.json";

/**
 * The app version, from package.json. The JSON import is bundled into the
 * compiled binary at build time, so no package.json is needed next to it at
 * runtime (verified by running dist/podtui from another directory). The
 * release workflow refuses a tag that differs from this value, so a released
 * binary always reports the version it was released as.
 */
export const VERSION: string = pkg.version;
