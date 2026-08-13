"""Shift SRT subtitle timestamps by a given offset in seconds."""

import re
import sys
from pathlib import Path


TIMESTAMP_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})"
)


def to_ms(h: int, m: int, s: int, ms: int) -> int:
    return ((h * 60 + m) * 60 + s) * 1000 + ms


def from_ms(total_ms: int) -> str:
    total_ms = max(0, total_ms)
    ms = total_ms % 1000
    total_s = total_ms // 1000
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def shift_timestamp_line(line: str, offset_ms: int) -> str:
    match = TIMESTAMP_RE.match(line.strip())
    if not match:
        return line

    groups = [int(g) for g in match.groups()]
    start_ms = to_ms(*groups[0:4]) - offset_ms
    end_ms = to_ms(*groups[4:8]) - offset_ms
    return f"{from_ms(start_ms)} --> {from_ms(end_ms)}"


def shift_srt(content: str, offset_seconds: float) -> str:
    offset_ms = round(offset_seconds * 1000)
    lines = content.splitlines()
    return "\n".join(
        shift_timestamp_line(line, offset_ms) if "-->" in line else line
        for line in lines
    )


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python shift-subtitles.py <input.srt> <offset_seconds> [output.srt]")
        sys.exit(1)

    input_path = Path(sys.argv[1])
    offset = float(sys.argv[2])
    output_path = Path(sys.argv[3]) if len(sys.argv) > 3 else input_path.with_stem(
        f"{input_path.stem}_shifted"
    )

    content = input_path.read_text(encoding="utf-8")
    output_path.write_text(shift_srt(content, offset), encoding="utf-8")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
