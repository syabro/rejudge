#!/usr/bin/env python3
"""Compare model results from bench/results.jsonl — one tasks x models table.

The data file keeps every run (append-only); here the latest graded result per
(model, task) wins for the headline. Pass@1 counts graded tasks only — infra-errored
tasks are shown as ERR and never counted as a model failure. Two models are compared
on their COMMON graded tasks, so different task subsets don't skew the number.

Usage: bench/compare.py
"""
import json, os

BENCH = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(BENCH, "results.jsonl")


def main():
    if not os.path.exists(STORE):
        raise SystemExit("no bench/results.jsonl yet — run bench/record.py after a run")

    latest = {}  # (model, task) -> row with the newest job id
    for line in open(STORE):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        k = (r["model"], r["task"])
        if k not in latest or r["job"] > latest[k]["job"]:
            latest[k] = r

    models = sorted({m for m, _ in latest})
    tasks = sorted({t for _, t in latest})
    if not models:
        raise SystemExit("results.jsonl is empty")

    w = max([len(t) for t in tasks] + [6])
    cw = max([len(m) for m in models] + [12])
    sep = "-" * (w + 2 + (cw + 2) * len(models))

    print("task".ljust(w) + "  " + "  ".join(m.center(cw) for m in models))
    print(sep)
    for t in tasks:
        cells = []
        for m in models:
            r = latest.get((m, t))
            if not r:
                cells.append("—".center(cw))
            elif r["status"] != "graded":
                cells.append("ERR".center(cw))
            else:
                mark = "PASS" if r["reward"] == 1 else "fail"
                cells.append(f"{r['new_pass']}/{r['new_need']} {mark}".center(cw))
        print(t.ljust(w) + "  " + "  ".join(cells))
    print(sep)

    def stats(m):
        rs = [r for (mm, _), r in latest.items() if mm == m]
        graded = [r for r in rs if r["status"] == "graded"]
        solved = sum(1 for r in graded if r["reward"] == 1)
        errored = sum(1 for r in rs if r["status"] != "graded")
        toks = sum((r.get("tokens_in") or 0) + (r.get("tokens_out") or 0) for r in graded)
        cost = sum((r.get("cost_usd_notional") or 0) for r in graded)
        return solved, len(graded), errored, toks, cost

    print("Pass@1".ljust(w) + "  " + "  ".join(
        f"{stats(m)[0]}/{stats(m)[1]}".center(cw) for m in models))
    print()
    for m in models:
        solved, n, errored, toks, cost = stats(m)
        pr = (next((r.get("pricing") for (mm, _), r in latest.items() if mm == m), "api"))
        note = f"  (+{errored} infra-err)" if errored else ""
        money = f"${cost:.2f} notional" if pr == "subscription" else f"${cost:.2f}"
        print(f"{m}: Pass@1 {solved}/{n}{note}  |  tokens {toks:,}  |  {money}")

    if len(models) == 2:
        a, b = models
        common = [t for t in tasks
                  if latest.get((a, t), {}).get("status") == "graded"
                  and latest.get((b, t), {}).get("status") == "graded"]
        sa = sum(1 for t in common if latest[(a, t)]["reward"] == 1)
        sb = sum(1 for t in common if latest[(b, t)]["reward"] == 1)
        print(f"\nОбщих задач (graded у обоих): {len(common)}"
              f"  |  {a}: {sa}/{len(common)}   {b}: {sb}/{len(common)}")


main()
