import json
from pathlib import Path

transcript = Path(r"C:\Users\vizat\.cursor\projects\c-Users-vizat-Documents-PokerLedger\agent-transcripts\66023e0a-d728-4948-b1d2-1b64eb9cd868\66023e0a-d728-4948-b1d2-1b64eb9cd868.jsonl")
out_path = Path(r"C:\Users\vizat\Documents\PokerLedger\_extract_analysis.txt")

def path_matches(p):
    if not p:
        return False
    pl = str(p).replace("\\", "/").lower()
    return pl.endswith("backend/app/schemas/analysis.py")

def extract_tool(tc):
    if not isinstance(tc, dict):
        return None
    name = tc.get("name") or tc.get("tool") or tc.get("toolName")
    args = tc.get("input") or tc.get("arguments") or tc.get("params") or tc.get("parameters")
    fn = tc.get("function")
    if isinstance(fn, dict):
        name = name or fn.get("name")
        args = args or fn.get("arguments")
    if name not in ("Write", "StrReplace"):
        return None
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            return None
    if not isinstance(args, dict):
        return None
    path = args.get("path") or args.get("file_path") or args.get("filePath")
    if not path_matches(path):
        return None
    return name, args

def walk(obj, out):
    if isinstance(obj, dict):
        r = extract_tool(obj)
        if r:
            out.append(r)
        for v in obj.values():
            walk(v, out)
    elif isinstance(obj, list):
        for item in obj:
            walk(item, out)

parts = []
count = 0
with transcript.open("r", encoding="utf-8") as f:
    for line_no, line in enumerate(f, 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        found = []
        walk(obj, found)
        # dedupe identical consecutive within line
        for name, args in found:
            count += 1
            parts.append(f"=== LINE {line_no} tool={name} ===")
            if name == "Write":
                contents = args.get("contents")
                if contents is None:
                    contents = args.get("content")
                parts.append(contents if contents is not None else json.dumps(args, indent=2))
            else:
                old = args.get("old_string") or args.get("oldString") or args.get("old_str")
                new = args.get("new_string") or args.get("newString") or args.get("new_str")
                parts.append("--- OLD ---")
                parts.append(old if old is not None else "")
                parts.append("--- NEW ---")
                parts.append(new if new is not None else "")
            parts.append("")

text = "\n".join(parts)
if text and not text.endswith("\n"):
    text += "\n"
out_path.write_text(text, encoding="utf-8")
print(f"matches={count}")
print(f"written={out_path}")
print(f"size_bytes={out_path.stat().st_size}")
