import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs, UsageError } from './args';
import { toValidPackageName, validatePackageName } from './name';
import { commandsFor, detectPackageManager, type PackageManager } from './package-manager';
import {
  copyTemplate,
  DEFAULT_TEMPLATE,
  isTemplateName,
  TEMPLATES,
  TEMPLATES_DIR,
  type TemplateName,
} from './template';
import { CREATE_SHOEHIVE_VERSION, defaultShoehiveSpec } from './version';

export const DEFAULT_DIR = 'my-game';
export const DOCS_URL = 'https://shoehive.jtay.co.uk';

/** The port `npm run dev` serves the app on (Vite's default). */
const DEV_URL = 'http://localhost:5173';

const PLAY_HINTS: Record<TemplateName, { open: string; tutorial: string }> = {
  'tic-tac-toe': {
    open: `Then open ${DEV_URL} in two browser windows, one of them private so that each\nwindow is a different player, and play.`,
    tutorial: `${DOCS_URL}/tutorials/tic-tac-toe/`,
  },
  blank: {
    open: `Then open ${DEV_URL}, create a game and press the button. A private browser\nwindow joins as a second player.`,
    tutorial: `${DOCS_URL}/tutorials/tic-tac-toe/`,
  },
};

export const USAGE = `Usage: npm create shoehive@latest [directory] -- [options]
       pnpm create shoehive [directory] [options]   (also yarn create, bun create)

Creates a new Shoehive game in [directory]. Asks for the directory when it is missing
(default "${DEFAULT_DIR}") and nothing else.

Options:
  -t, --template <name>         ${TEMPLATES.map((t) => t.name).join(' or ')} (default: ${DEFAULT_TEMPLATE})
      --package-manager <name>  npm, pnpm, yarn or bun (default: the one running this, else npm)
      --no-install              Do not install dependencies
      --no-git                  Do not run git init
      --shoehive <spec>         Version spec for the shoehive dependency (default: ${defaultShoehiveSpec()})
  -y, --yes                     Never prompt: use the defaults
  -h, --help                    Show this help
  -v, --version                 Show the create-shoehive version

Templates:
${TEMPLATES.map((t) => `  ${t.name.padEnd(13)} ${t.description}`).join('\n')}

With npm, put options after "--": npm create shoehive@latest my-game -- --template blank
Docs: ${DOCS_URL}`;

/** Everything the CLI touches outside its own logic, so tests can replace it. */
export interface RunOptions {
  argv: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Whether prompts are possible. Default: `process.stdin.isTTY`. */
  interactive?: boolean;
  log?: (line: string) => void;
  error?: (line: string) => void;
  /** Asks a question and resolves with the answer (without the newline). */
  prompt?: (question: string) => Promise<string>;
  /** Runs a command and returns its exit code (`null` when it could not start). */
  exec?: (command: string, args: readonly string[], cwd: string, quiet: boolean) => number | null;
}

/** Runs the CLI and resolves with the process exit code. */
export async function run(options: RunOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const error = options.error ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const exec = options.exec ?? execCommand;

  try {
    const args = parseArgs(options.argv);
    if (args.help) {
      log(USAGE);
      return 0;
    }
    if (args.version) {
      log(CREATE_SHOEHIVE_VERSION);
      return 0;
    }

    const template = args.template ?? DEFAULT_TEMPLATE;
    if (!isTemplateName(template)) {
      throw new UsageError(
        `Unknown template "${template}". Use one of: ${TEMPLATES.map((t) => t.name).join(', ')}.`,
      );
    }
    const pm: PackageManager =
      args.packageManager ?? detectPackageManager(env['npm_config_user_agent']);
    const interactive = !args.yes && (options.interactive ?? process.stdin.isTTY);

    const dir =
      args.dir ?? (interactive ? await askForDirectory(options.prompt ?? ask, error) : DEFAULT_DIR);

    const root = resolve(cwd, dir);
    const name = toValidPackageName(basename(root));
    const problem = validatePackageName(name);
    if (problem !== null) {
      throw new UsageError(`Cannot make a package name from "${basename(root)}": ${problem}`);
    }
    checkTarget(root);

    log(`Creating a Shoehive game in ${root} (template: ${template})`);
    const commands = commandsFor(pm);
    await mkdir(root, { recursive: true });
    await copyTemplate(join(TEMPLATES_DIR, template), root, {
      name,
      shoehiveVersion: args.shoehive ?? defaultShoehiveSpec(),
      install: commands.install,
      run: commands.run,
    });

    if (args.git) initGit(root, exec);

    let installed = false;
    if (args.install) {
      log(`\nInstalling dependencies with ${pm}...\n`);
      const [command, ...rest] = commands.installArgv;
      const code = exec(command, rest, root, false);
      installed = code === 0;
      if (!installed) {
        error(`\n${commands.install} failed. Fix the problem above, then run it yourself.`);
      }
    }

    log('');
    log(nextSteps({ cwd, root, template, pm, installed }));
    return args.install && !installed ? 1 : 0;
  } catch (err) {
    if (err instanceof UsageError) {
      error(`Error: ${err.message}`);
      error('Run "npm create shoehive@latest -- --help" for usage.');
      return 1;
    }
    error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

/** The "what now" message, adapted to the package manager and the directory. */
export function nextSteps(options: {
  cwd: string;
  root: string;
  template: TemplateName;
  pm: PackageManager;
  installed: boolean;
}): string {
  const commands = commandsFor(options.pm);
  const lines: string[] = [];
  const rel = relative(options.cwd, options.root);
  if (rel !== '') lines.push(`cd ${quoteIfNeeded(rel)}`);
  if (!options.installed) lines.push(commands.install);
  lines.push(`${commands.run} dev`);
  const hint = PLAY_HINTS[options.template];
  return [
    'Done. Next steps:',
    '',
    ...lines.map((line) => `  ${line}`),
    '',
    hint.open,
    '',
    `Tutorials: ${hint.tutorial}`,
  ].join('\n');
}

function quoteIfNeeded(path: string): string {
  return /^[\w./\\:-]+$/.test(path) ? path : `"${path.replace(/"/g, '\\"')}"`;
}

/** Refuses a target that is a file or a directory with anything but `.git` in it. */
function checkTarget(root: string): void {
  if (!existsSync(root)) return;
  if (!statSync(root).isDirectory()) throw new UsageError(`${root} exists and is not a directory.`);
  const entries = readdirSync(root).filter((entry) => entry !== '.git' && entry !== '.DS_Store');
  if (entries.length > 0) {
    throw new UsageError(`${root} is not empty. Choose a new or empty directory.`);
  }
}

async function askForDirectory(
  prompt: (question: string) => Promise<string>,
  error: (line: string) => void,
): Promise<string> {
  for (;;) {
    const answer = (await prompt(`Project directory (${DEFAULT_DIR}): `)).trim();
    const dir = answer === '' ? DEFAULT_DIR : answer;
    const problem = validatePackageName(toValidPackageName(basename(resolve(dir))));
    if (problem === null) return dir;
    error(`That will not work as a package name: ${problem}`);
  }
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** `git init` unless git is missing or `root` is already inside a work tree. Never throws. */
function initGit(root: string, exec: NonNullable<RunOptions['exec']>): void {
  try {
    if (exec('git', ['--version'], root, true) !== 0) return;
    if (exec('git', ['rev-parse', '--is-inside-work-tree'], root, true) === 0) return;
    exec('git', ['init', '--quiet'], root, true);
  } catch {
    // Quietly skip: a repository is a convenience, not a requirement.
  }
}

function execCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  quiet: boolean,
): number | null {
  const result = spawnSync(command, args, {
    cwd,
    stdio: quiet ? 'ignore' : 'inherit',
    // npm, pnpm and yarn are .cmd shims on Windows.
    shell: process.platform === 'win32',
  });
  return result.error ? null : result.status;
}
