#!/usr/bin/env python3
"""Stage 1 — FETCH only. Download DeepSWE per-trial test-stdout.txt artifacts.

No parsing here (that's deepswe_f2p.py). Idempotent: already-downloaded non-empty
files are skipped, so re-running resumes. Plain stdlib (urllib), runs without deps.

Source of truth:
  - trials index: https://deepswe.datacurve.ai/artifacts/v1/trials.json (Accept: application/json)
  - raw test output: <CDN>/trial-artifacts/<trial_name>/verifier/test-stdout.txt

Targets the leaderboard configs gpt-5-5@xhigh and glm-5-2@max, scope=full, included_in_score.
Writes bench/deepswe-artifacts/<model>@<effort>/<trial_name>.txt + fetch-manifest.jsonl.
Non-200s are recorded in the manifest (no silent gaps).

Usage: bench/deepswe_fetch.py
"""
import json, os, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

BENCH = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BENCH, "deepswe-artifacts")
TRIALS_URL = "https://deepswe.datacurve.ai/artifacts/v1/trials.json"
CDN = "https://d3ujjcmjq6o8v6.cloudfront.net/trial-artifacts"
TARGETS = {("gpt-5-5", "xhigh"), ("glm-5-2", "max")}


def http_get(url, accept=None):
    req = urllib.request.Request(url, headers={"Accept": accept} if accept else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.read()


def load_trials():
    cache = os.path.join(OUT, "trials.json")
    if os.path.exists(cache) and os.path.getsize(cache) > 1000:
        return json.load(open(cache))
    print("fetching trials index…")
    _, body = http_get(TRIALS_URL, accept="application/json")
    os.makedirs(OUT, exist_ok=True)
    open(cache, "wb").write(body)
    return json.loads(body)


def fetch_one(trial):
    model, effort, tn = trial["model"], trial.get("reasoning_effort"), trial["trial_name"]
    dest_dir = os.path.join(OUT, f"{model}@{effort}")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{tn}.txt")
    url = f"{CDN}/{tn}/verifier/test-stdout.txt"

    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return {**_row(trial, url, dest), "http_status": 200, "bytes": os.path.getsize(dest), "cached": True}

    try:
        status, body = http_get(url)
        open(dest, "wb").write(body)
        return {**_row(trial, url, dest), "http_status": status, "bytes": len(body), "cached": False}
    except urllib.error.HTTPError as e:
        return {**_row(trial, url, dest), "http_status": e.code, "bytes": 0, "cached": False}
    except Exception as e:
        return {**_row(trial, url, dest), "http_status": f"ERR:{type(e).__name__}", "bytes": 0, "cached": False}


def _row(trial, url, dest):
    return {
        "task": trial["task_name"],
        "model": trial["model"],
        "effort": trial.get("reasoning_effort"),
        "trial_name": trial["trial_name"],
        "passed": trial.get("passed"),
        "url": url,
        "local_path": os.path.relpath(dest, BENCH),
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    d = load_trials()
    rows = d["rows"] if isinstance(d, dict) else d
    targets = [
        r for r in rows
        if r["source"] == "deep-swe" and r.get("eval_scope") == "full"
        and r.get("included_in_score") and (r["model"], r.get("reasoning_effort")) in TARGETS
    ]
    print(f"target trials: {len(targets)}")

    results = []
    with ThreadPoolExecutor(max_workers=16) as ex:
        for i, res in enumerate(ex.map(fetch_one, targets), 1):
            results.append(res)
            if i % 100 == 0:
                print(f"  {i}/{len(targets)}…")

    with open(os.path.join(OUT, "fetch-manifest.jsonl"), "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")

    ok = sum(1 for r in results if r["http_status"] == 200)
    cached = sum(1 for r in results if r.get("cached"))
    bad = [r for r in results if r["http_status"] != 200]
    print(f"\ndone: {ok}/{len(results)} ok ({cached} cached), {len(bad)} not-200")
    for r in bad[:20]:
        print(f"  [{r['http_status']}] {r['model']}@{r['effort']} {r['trial_name']}")


main()
