#!/usr/bin/env python3
"""Stage 2 — ANALYZE. Parse fetched test-stdout.txt into per-run F2P stats.

Offline only — reads bench/deepswe-artifacts/ (from deepswe_fetch.py) + local
tests/config.json + task.toml. No network. Plain stdlib.

Per run we want how close the model got on the NEW (F2P) tests:
  - f2p_total = len(f2p_node_ids) from the benchmark's tests/config.json (authoritative).
  - the verifier's own f2p gate is "[verifier] New tests exit code: N" (N==0 => all f2p
    passed), uniform across languages.
  - on a miss (exit!=0) we parse the runner's passed count per language (Go/Rust give real
    counts; pytest is failfast so it's "passed before first failure").
  - reward (overall, from the trials index) = f2p AND p2p, so a run can have all f2p passing
    yet reward False (broke an old test) -> p2p_regression flag. progress is NOT cross-checked
    against reward.

Output: bench/deepswe-f2p.jsonl (one row per task/model/run).
Usage: bench/deepswe_f2p.py
"""
import json, os, re, glob

BENCH = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(BENCH, "deepswe-artifacts")
TASKS = os.path.join(BENCH, "vendor", "deep-swe", "tasks")
OUT = os.path.join(BENCH, "deepswe-f2p.jsonl")


def task_language(task):
    tt = os.path.join(TASKS, task, "task.toml")
    if os.path.exists(tt):
        m = re.search(r'language\s*=\s*"?(\w+)', open(tt).read())
        if m:
            return m.group(1)
    return None


def f2p_total(task):
    cfg = os.path.join(TASKS, task, "tests", "config.json")
    if os.path.exists(cfg):
        return len(json.load(open(cfg)).get("f2p_node_ids", []))
    return None


def step4_block(text):
    """Return (block, exit_code) for the 'new tests' (F2P) run."""
    i = text.find("Step 4: Running new tests")
    block = text[i:] if i != -1 else ""
    m = re.search(r"New tests exit code:\s*(-?\d+)", block)
    return block, (int(m.group(1)) if m else None)


def parse_passed(lang, block, total):
    """Return (passed, failed, build_failed) for a run that did NOT pass cleanly.

    failed is None when the runner can't report it reliably (pytest failfast — it stops at
    the first failure, so the true count of remaining failures is unknown).
    """
    if lang == "python":
        nums = re.findall(r"(\d+) passed", block)
        if not nums:
            return 0, None, True            # no summary => collection/build error
        return int(nums[-1]), None, False    # failfast: passed-before-stop; failed unknown
    if lang in ("typescript", "javascript"):  # mocha runs the whole file (not failfast)
        passing = sum(int(x) for x in re.findall(r"(\d+) passing", block))
        failing = sum(int(x) for x in re.findall(r"(\d+) failing", block))
        if "passing" not in block and "failing" not in block:
            return 0, None, True
        return passing, failing, False
    if lang == "go":  # runs all tests; prints one top-level "--- FAIL:" per failed func
        failed = len(re.findall(r"(?m)^--- FAIL:", block))
        has_ok = bool(re.search(r"(?m)^ok\s", block))
        if failed == 0 and not has_ok:
            return 0, None, True            # didn't build / nothing ran
        return max((total or 0) - failed, 0), failed, False
    if lang == "rust":  # cargo prints "N passed; M failed" per result line; runs all
        res = re.findall(r"test result:\s+\S+\.\s+(\d+) passed;\s+(\d+) failed", block)
        if not res:
            return 0, None, True
        return sum(int(p) for p, _ in res), sum(int(f) for _, f in res), False
    return 0, None, True


def main():
    manifest = os.path.join(ART, "fetch-manifest.jsonl")
    rows = [json.loads(l) for l in open(manifest) if l.strip()]

    out = []
    for r in rows:
        path = os.path.join(BENCH, r["local_path"])
        if r.get("http_status") != 200 or not os.path.exists(path):
            continue
        task = r["task"]
        lang = task_language(task)
        total = f2p_total(task)
        text = open(path, encoding="utf-8", errors="replace").read()
        block, exit_code = step4_block(text)

        failed = None
        build_failed = False
        if exit_code == 0:
            passed, progress, quality = total, 1.0, "clean"
        else:
            passed, failed, build_failed = parse_passed(lang, block, total)
            if build_failed:
                progress, quality = 0.0, "build_failed"
            elif failed is not None:                      # go / rust / mocha: real counts
                denom = passed + failed
                progress = round(passed / denom, 4) if denom else 0.0
                quality = "exact"
            elif passed is not None and total:            # pytest failfast: lower bound
                progress = round(min(passed / total, 1.0), 4)
                quality = "lowerbound"
            else:
                progress, quality = None, "unknown"

        reward = r.get("passed")
        out.append({
            "task": task, "language": lang, "model": r["model"], "effort": r.get("effort"),
            "trial_name": r["trial_name"], "reward": reward, "exit_code": exit_code,
            "f2p_total": total, "f2p_passed": passed, "f2p_failed": failed,
            "progress": progress, "progress_quality": quality,
            "p2p_regression": (reward is False and exit_code == 0),
            "build_failed": build_failed,
        })

    with open(OUT, "w") as f:
        for o in out:
            f.write(json.dumps(o) + "\n")
    print(f"wrote {len(out)} rows -> {os.path.relpath(OUT, BENCH)}")

    # quick health
    import collections
    miss_total = sum(1 for o in out if o["f2p_total"] is None)
    miss_exit = sum(1 for o in out if o["exit_code"] is None)
    q = collections.Counter(o["progress_quality"] for o in out)
    print(f"  no f2p_total: {miss_total} | no exit_code: {miss_exit}")
    print(f"  progress_quality: {dict(q)}")


main()
