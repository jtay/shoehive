// The `create-shoehive` bin: `npm create shoehive@latest [dir]`. The shebang is added by tsup.
import { run } from './cli';

process.exitCode = await run({ argv: process.argv.slice(2) });
