import { isPackageManager, PACKAGE_MANAGERS, type PackageManager } from './package-manager';

/** What the command line asked for. Unset fields fall back to defaults or prompts. */
export interface Args {
  /** The target directory, if given. */
  dir: string | undefined;
  template: string | undefined;
  /** `false` with `--no-install`. */
  install: boolean;
  /** `false` with `--no-git`. */
  git: boolean;
  packageManager: PackageManager | undefined;
  /** An npm version spec for `shoehive` (for example `^1.0.0` or `file:../shoehive.tgz`). */
  shoehive: string | undefined;
  /** Accept defaults instead of prompting. */
  yes: boolean;
  help: boolean;
  version: boolean;
}

/** A mistake on the command line: printed with a pointer to `--help`, exit code 1. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const VALUE_FLAGS = {
  '--template': 'template',
  '-t': 'template',
  '--package-manager': 'packageManager',
  '--pm': 'packageManager',
  '--shoehive': 'shoehive',
} as const;

const BOOLEAN_FLAGS = {
  '--install': ['install', true],
  '--no-install': ['install', false],
  '--git': ['git', true],
  '--no-git': ['git', false],
  '--yes': ['yes', true],
  '-y': ['yes', true],
  '--help': ['help', true],
  '-h': ['help', true],
  '--version': ['version', true],
  '-v': ['version', true],
} as const;

const isValueFlag = (flag: string): flag is keyof typeof VALUE_FLAGS => flag in VALUE_FLAGS;
const isBooleanFlag = (flag: string): flag is keyof typeof BOOLEAN_FLAGS => flag in BOOLEAN_FLAGS;

/**
 * Parses `create-shoehive [dir] [options]`. Accepts `--flag value` and `--flag=value`.
 * Throws {@link UsageError} for unknown flags, missing values and extra positionals.
 */
export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    dir: undefined,
    template: undefined,
    install: true,
    git: true,
    packageManager: undefined,
    shoehive: undefined,
    yes: false,
    help: false,
    version: false,
  };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (isValueFlag(flag)) {
      let value: string | undefined;
      if (eq !== -1) {
        value = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          value = next;
          i++;
        }
      }
      if (!value) throw new UsageError(`${flag} needs a value.`);
      const key = VALUE_FLAGS[flag];
      if (key === 'packageManager') {
        if (!isPackageManager(value)) {
          throw new UsageError(
            `Unknown package manager "${value}". Use one of: ${PACKAGE_MANAGERS.join(', ')}.`,
          );
        }
        args.packageManager = value;
      } else {
        args[key] = value;
      }
      continue;
    }
    if (isBooleanFlag(flag)) {
      if (eq !== -1) throw new UsageError(`${flag} does not take a value.`);
      const [key, value] = BOOLEAN_FLAGS[flag];
      args[key] = value;
      continue;
    }
    throw new UsageError(`Unknown option ${flag}.`);
  }

  if (positionals.length > 1) {
    throw new UsageError(
      `Expected one directory, got ${String(positionals.length)}: ${positionals.join(' ')}.`,
    );
  }
  args.dir = positionals[0];
  return args;
}
