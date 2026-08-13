import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const transcriptPath =
  "C:/Users/User/.cursor/projects/c-Users-User-Desktop-Files-Development-rad-dash/agent-transcripts/1ecc0de3-b463-44b5-a651-910d3773ff42/1ecc0de3-b463-44b5-a651-910d3773ff42.jsonl";

const line = readFileSync(transcriptPath, "utf8").split(/\r?\n/).find(Boolean);
if (!line) {
  throw new Error("Transcript file is empty");
}

const payload = JSON.parse(line);
const raw = payload.message.content[0].text;
const match = raw.match(/<user_query>\n([\s\S]*?)\n\nLess 1\.5 seconds/);
if (!match) {
  throw new Error("Could not extract subtitle content from transcript");
}

const inputPath = resolve(scriptDir, "betty-input.srt");
const outputPath = resolve(scriptDir, "betty-shifted.srt");
const srt = match[1];

writeFileSync(inputPath, srt, "utf8");
writeFileSync(outputPath, shiftSrt(srt, 1.5), "utf8");

console.log(`Input:  ${inputPath}`);
console.log(`Output: ${outputPath}`);
