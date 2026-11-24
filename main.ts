// main.ts — the program the harness runs: reads every case from
// /input/cases.json, answers each with run, and writes /output/answers.json.
// The paths come from the mount stand-ins when the harness runs outside a
// container (the local process driver sets MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR); inside the grader's container the mounts are the
// literal /input and /output.
import { setFlagsFromString } from 'node:v8';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// The house baseline turns V8's incremental marking off before it imports
// solve.js, and is timed with it; this entry tunes V8's flags the same way.
setFlagsFromString('--no-incremental-marking');

const { run } = await import('./solve.js');

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(readFileSync(`${inputDir}/cases.json`, 'utf8'));
const answers = [];
for (const c of cases) answers.push(run(c.input));
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/answers.json`, JSON.stringify(answers));
