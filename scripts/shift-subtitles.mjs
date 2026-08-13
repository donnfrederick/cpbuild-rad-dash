import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TIMESTAMP_RE =
  /^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})$/;

function toMs(h, m, s, ms) {
  return ((h * 60 + m) * 60 + s) * 1000 + ms;
}

function fromMs(totalMs) {
  let t = Math.max(0, totalMs);
  const ms = t % 1000;
  t = Math.floor(t / 1000);
  const s = t % 60;
  t = Math.floor(t / 60);
  const m = t % 60;
  const h = Math.floor(t / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function shiftLine(line, offsetMs) {
  const match = line.trim().match(TIMESTAMP_RE);
  if (!match) return line;

  const groups = match.slice(1).map(Number);
  const start = fromMs(toMs(...groups.slice(0, 4)) - offsetMs);
  const end = fromMs(toMs(...groups.slice(4, 8)) - offsetMs);
  return `${start} --> ${end}`;
}

function shiftSrt(content, offsetSeconds) {
  const offsetMs = Math.round(offsetSeconds * 1000);
  return content
    .split(/\r?\n/)
    .map((line) => (line.includes("-->") ? shiftLine(line, offsetMs) : line))
    .join("\n");
}

const [, , inputArg, offsetArg, outputArg] = process.argv;

if (!inputArg || offsetArg === undefined) {
  console.error("Usage: node shift-subtitles.mjs <input.srt> <offset_seconds> [output.srt]");
  process.exit(1);
}

const inputPath = resolve(inputArg);
const offset = Number(offsetArg);
const outputPath = outputArg
  ? resolve(outputArg)
  : inputPath.replace(/(\.[^.]+)?$/, "_shifted$1");

const content = readFileSync(inputPath, "utf8");
writeFileSync(outputPath, shiftSrt(content, offset), "utf8");
console.log(`Wrote ${outputPath}`);
