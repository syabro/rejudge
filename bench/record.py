#!/usr/bin/env python3
"""Distill a pier job dir into bench/results.jsonl — one immutable line per (run, task).

Append-only: never overwrites a previous line, and re-recording the same job is a
no-op (keyed on model+task+job). `status` separates a graded run from an infra crash,
so a failed sandbox never masquerades as a model miss. compare.py reads this file.

Pure stdlib (plain python3), so it runs without pier's venv. One row per trial:
  {model, task, status, reward, new_pass/new_need, old_broke/old_total,
   tokens_in/tokens_out/reasoning, secs, steps, cost_usd_notional, pricing,
   base_commit, job}

Usage: bench/record.py [JOB_DIR]   (default: newest bench/jobs/<timestamp>)
"""
import json, os, sys, glob, datetime

BENCH = os.path.dirname(os.path.abspath(__file__))
JOBS = os.path.join(BENCH, "jobs")
STORE = os.path.join(BENCH, "results.jsonl")


def newest_job():
    dirs = sorted(glob.glob(os.path.join(JOBS, "20*")))
    return dirs[-1] if dirs else None


def model_label(cfg):
    """(agent, 'agent:model@effort', pricing) from the trial's agent config."""
    a = cfg.get("agent", {}) or {}
    ip, name = a.get("import_path"), a.get("name")
    agent = ip.split(":", 1)[0].removesuffix("_agent") if ip else (name or "?")
    model = a.get("model_name") or "?"

    effort = (a.get("kwargs") or {}).get("reasoning_effort")
    if not effort and agent == "codex":
        effort = "high"  # codex agent's CLI default when none is passed

    label = f"{agent}:{model}" + (f"@{effort}" if effort else "")
    pricing = "subscription" if agent == "codex" else "api"
    return agent, label, pricing


def duration_secs(res):
    s, f = res.get("started_at"), res.get("finished_at")
    try:
        parse = lambda x: datetime.datetime.fromisoformat(x.replace("Z", "+00:00"))
        return int((parse(f) - parse(s)).total_seconds())
    except Exception:
        return None


def base_commit(task_path):
    tt = os.path.join(task_path, "task.toml")
    if os.path.exists(tt):
        for line in open(tt):
            if "base_commit_hash" in line:
                return line.split("=", 1)[1].strip().strip('"')
    return None


def main():
    job = sys.argv[1] if len(sys.argv) > 1 else newest_job()
    if not job or not os.path.isdir(job):
        sys.exit(f"no job dir: {job}")
    job_id = os.path.basename(job.rstrip("/"))

    seen = set()
    if os.path.exists(STORE):
        for line in open(STORE):
            line = line.strip()
            if line:
                r = json.loads(line)
                seen.add((r["model"], r["task"], r["job"]))

    rows = []
    for trial in sorted(glob.glob(os.path.join(job, "*", ""))):
        tr = os.path.join(trial, "result.json")
        if not os.path.exists(tr):
            continue
        res = json.load(open(tr))
        cfg = res.get("config", {}) or {}
        _, label, pricing = model_label(cfg)
        task_path = (cfg.get("task", {}) or {}).get("path", "")
        task = os.path.basename(task_path) or res.get("task_name", "").split("/")[-1]
        if (label, task, job_id) in seen:
            continue

        row = {"model": label, "task": task, "job": job_id}

        reward_path = os.path.join(trial, "verifier", "reward.json")
        if os.path.exists(reward_path):
            rw = json.load(open(reward_path))
            p2p_total = int(rw.get("p2p_total", 0))
            row.update(
                status="graded",
                reward=rw.get("reward"),
                new_pass=int(rw.get("f2p_passed", 0)),
                new_need=int(rw.get("f2p_total", 0)),
                old_broke=p2p_total - int(rw.get("p2p_passed", 0)),
                old_total=p2p_total,
            )
        else:
            ei = res.get("exception_info")
            kind = ei.get("type") if isinstance(ei, dict) else (
                str(ei).split("(")[0].split(":")[0] if ei else "unknown"
            )
            row.update(
                status="errored", error_kind=kind, reward=None,
                new_pass=None, new_need=None, old_broke=None, old_total=None,
            )

        ti = to = reason = 0
        cost = None
        tj = os.path.join(trial, "agent", "trajectory.json")
        if os.path.exists(tj):
            fm = json.load(open(tj)).get("final_metrics") or {}
            ti = fm.get("total_prompt_tokens") or 0
            to = fm.get("total_completion_tokens") or 0
            reason = (fm.get("extra") or {}).get("reasoning_output_tokens") or 0
            cost = fm.get("total_cost_usd")

        row.update(
            tokens_in=ti, tokens_out=to, reasoning=reason,
            secs=duration_secs(res), steps=res.get("n_agent_steps"),
            cost_usd_notional=cost, pricing=pricing,
            base_commit=base_commit(task_path),
        )
        rows.append(row)

    if not rows:
        print(f"nothing new to record from {job_id}")
        return

    with open(STORE, "a") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"recorded {len(rows)} row(s) from {job_id} -> bench/results.jsonl")


main()
