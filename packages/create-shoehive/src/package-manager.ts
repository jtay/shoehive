export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

/**
 * The package manager that launched us, from `npm_config_user_agent`
 * (for example `pnpm/10.28.0 npm/? node/v22.20.0 linux x64`). Defaults to npm.
 */
export function detectPackageManager(userAgent: string | undefined): PackageManager {
  const name = userAgent?.split(' ')[0]?.split('/')[0];
  return name !== undefined && isPackageManager(name) ? name : 'npm';
}

/** The commands to show and run for a package manager. */
export interface PackageManagerCommands {
  /** Installs dependencies, as shown to people: for example `npm install`, or `yarn`. */
  install: string;
  /** The command and arguments we run to install. */
  installArgv: readonly [string, ...string[]];
  /** Runs a package.json script: `${run} dev`, for example `npm run dev`. */
  run: string;
}

export function commandsFor(pm: PackageManager): PackageManagerCommands {
  switch (pm) {
    case 'npm':
      return { install: 'npm install', installArgv: ['npm', 'install'], run: 'npm run' };
    case 'pnpm':
      return { install: 'pnpm install', installArgv: ['pnpm', 'install'], run: 'pnpm' };
    case 'yarn':
      return { install: 'yarn', installArgv: ['yarn', 'install'], run: 'yarn' };
    case 'bun':
      return { install: 'bun install', installArgv: ['bun', 'install'], run: 'bun run' };
  }
}
