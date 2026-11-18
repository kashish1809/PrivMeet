"""Memory of a process and all its descendants (Linux /proc). Used by scripts/bench.sh.
  python -I mem.py now <pid>                     RSS and PSS now, in MB
  python -I mem.py peak <pid> <url> [interval]   peak tree RSS until <url>'s JSON has status done/failed
"""
import json, os, sys, time, urllib.request


def tree(pid):
    kids = {}
    for p in os.listdir("/proc"):
        if p.isdigit():
            try:
                ppid = int(open(f"/proc/{p}/stat").read().rsplit(")", 1)[1].split()[1])
                kids.setdefault(ppid, []).append(int(p))
            except OSError:
                pass
    out, todo = [], [pid]
    while todo:
        p = todo.pop()
        out.append(p)
        todo += kids.get(p, [])
    return out


def field(pid, name, f="status"):
    try:
        for line in open(f"/proc/{pid}/{f}"):
            if line.startswith(name + ":"):
                return int(line.split()[1])
    except OSError:
        pass
    return 0


def now(pid):
    ps = tree(pid)
    rss = sum(field(p, "VmRSS") for p in ps) / 1024
    pss = sum(field(p, "Pss", "smaps_rollup") for p in ps) / 1024
    return rss, pss, len(ps)


if sys.argv[1] == "now":
    rss, pss, n = now(int(sys.argv[2]))
    print(f"rss={rss:.1f} pss={pss:.1f} procs={n}")
elif sys.argv[1] == "until":
    pid, stop = int(sys.argv[2]), sys.argv[3]
    peak, t0 = 0.0, time.time()
    while not os.path.exists(stop):
        peak = max(peak, sum(field(p, "VmRSS") for p in tree(pid)) / 1024)
        time.sleep(0.1)
    print(f"peak_rss={peak:.1f} seconds={time.time() - t0:.0f}")
else:
    pid, url = int(sys.argv[2]), sys.argv[3]
    step = float(sys.argv[4]) if len(sys.argv) > 4 else 0.2
    peak, t0, last = 0.0, time.time(), 0.0
    while True:
        ps = tree(pid)
        peak = max(peak, sum(field(p, "VmRSS") for p in ps) / 1024)
        if time.time() - last > 1:
            last = time.time()
            try:
                st = json.load(urllib.request.urlopen(url, timeout=5))["status"]
            except Exception:
                st = "?"
            if st in ("done", "failed"):
                break
        time.sleep(step)
    print(f"peak_rss={peak:.1f} status={st} seconds={time.time() - t0:.0f}")
