#!/usr/bin/env python3
"""Aggregate deepswe-f2p.jsonl into a per-task difficulty table for picking medium tasks.

Per (task, model) over its (<=4) runs:
  solved  = reward True count / n        (the real benchmark outcome: f2p AND p2p)
  f2p     = exit_code==0 count / n       (implemented the new feature, ignoring p2p)
  prog    = mean progress over all runs  (how close, 0..1)
  prog_miss = mean progress over runs where reward is False (how close on misses)

Writes bench/deepswe-difficulty.csv (all tasks, sortable) and prints the medium band.
Usage: bench/deepswe_f2p_report.py
"""
import json, os, csv, collections

BENCH = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BENCH, "deepswe-f2p.jsonl")
CSV = os.path.join(BENCH, "deepswe-difficulty.csv")
MODELS = ["gpt-5-5", "glm-5-2"]


def agg(runs):
    n = len(runs)
    solved = sum(1 for r in runs if r["reward"] is True)
    f2p = sum(1 for r in runs if r["exit_code"] == 0)
    progs = [r["progress"] for r in runs if r["progress"] is not None]
    miss = [r["progress"] for r in runs if r["reward"] is False and r["progress"] is not None]
    return {
        "n": n, "solved": solved, "f2p": f2p,
        "prog": round(sum(progs) / len(progs), 3) if progs else None,
        "prog_miss": round(sum(miss) / len(miss), 3) if miss else None,
        "p2p_reg": sum(1 for r in runs if r["p2p_regression"]),
        "build_fail": sum(1 for r in runs if r["build_failed"]),
    }


def main():
    rows = [json.loads(l) for l in open(SRC) if l.strip()]
    by = collections.defaultdict(lambda: collections.defaultdict(list))
    meta = {}
    for r in rows:
        by[r["task"]][r["model"]].append(r)
        meta[r["task"]] = (r["language"], r["f2p_total"])

    table = []
    for task in sorted(by):
        lang, total = meta[task]
        row = {"task": task, "lang": lang, "f2p_total": total}
        for m in MODELS:
            a = agg(by[task][m]) if by[task].get(m) else None
            row[m] = a
        table.append(row)

    # CSV
    with open(CSV, "w", newline="") as f:
        w = csv.writer(f)
        head = ["task", "lang", "f2p_total"]
        for m in MODELS:
            tag = m.replace("gpt-5-5", "gpt55").replace("glm-5-2", "glm52")
            head += [f"{tag}_solved", f"{tag}_f2p", f"{tag}_prog", f"{tag}_prog_miss", f"{tag}_n"]
        w.writerow(head)
        for row in table:
            line = [row["task"], row["lang"], row["f2p_total"]]
            for m in MODELS:
                a = row[m]
                if a:
                    line += [f"{a['solved']}/{a['n']}", f"{a['f2p']}/{a['n']}", a["prog"], a["prog_miss"], a["n"]]
                else:
                    line += ["-", "-", "-", "-", 0]
            w.writerow(line)
    print(f"wrote {len(table)} tasks -> {os.path.relpath(CSV, BENCH)}")

    # medium band: BOTH models solve strictly between 0 and n (not always-fail, not always-pass)
    def midband(row):
        for m in MODELS:
            a = row[m]
            if not a or a["n"] == 0:
                return False
            if a["solved"] == 0 or a["solved"] == a["n"]:
                return False
        return True

    mid = [r for r in table if midband(r)]
    # rank by closeness of both solve-rates to 0.5
    def dist(row):
        return sum(abs(row[m]["solved"] / row[m]["n"] - 0.5) for m in MODELS)
    mid.sort(key=dist)

    print(f"\n=== MEDIUM BAND: both models solved 1..n-1 of n  ({len(mid)} tasks) ===")
    print(f"{'task':44}{'lang':6}{'f2p#':5}  gpt55(solv/f2p/prog)   glm52(solv/f2p/prog)")
    for r in mid:
        g, l = r["gpt-5-5"], r["glm-5-2"]
        print(f"{r['task']:44}{r['lang']:6}{str(r['f2p_total']):5}  "
              f"{g['solved']}/{g['n']} f2p{g['f2p']}/{g['n']} p{g['prog']!s:5}   "
              f"{l['solved']}/{l['n']} f2p{l['f2p']}/{l['n']} p{l['prog']!s:5}")

    # by language coverage
    print("\n=== tasks per language (all) ===")
    lc = collections.Counter(r["lang"] for r in table)
    print(dict(sorted(lc.items())))


main()
