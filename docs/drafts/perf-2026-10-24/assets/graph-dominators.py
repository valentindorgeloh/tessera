# Rank first-party modules by bytes that would leave a route's first-load JS if the module were loaded lazily.
import json,collections,re,sys
G="graph.jsonl"
mods={}; groups=collections.defaultdict(list); sizes=collections.defaultdict(lambda: collections.defaultdict(int))
with open(G) as f:
    for line in f:
        o=json.loads(line); t=o["type"]
        if t=="module": mods[o["ident"]]=o
        elif t=="group":
            if any(x.startswith("[client-fs]") for x in o["outputs"]): groups[o["route"]].append(o)
        elif t=="part" and o["filename"].startswith("[client-fs]") and o["filename"].endswith(".js"):
            sizes[o["route"]][o["source_path"]]+=o["size"]
def closure(roots, banned=frozenset()):
    seen=set(); st=[r for r in roots if r not in banned]
    while st:
        x=st.pop()
        if x in seen or x in banned: continue
        if "[app-client]" not in x: continue
        seen.add(x); m=mods.get(x)
        if m:
            for d in m["dependencies"]["sync"]:
                if d not in seen and d not in banned: st.append(d)
    return seen
route=sys.argv[1]; minkb=float(sys.argv[2]) if len(sys.argv)>2 else 15
roots=[g["trigger_module_ident"] for g in groups[route] if g["kind"] in("bootstrap","render_dependent") and "[app-client]" in g["trigger_module_ident"]]
R0=closure(roots)
def kb(ids): return sum(sizes[route].get(mods[i]["path"],0) for i in ids if i in mods)/1024
tot=kb(R0)
# paths to dedupe idents of same path
cand=[i for i in R0 if "[project]/src/" in i and re.search(r"\.(tsx|ts)",i)]
seenp=set(); cand=[i for i in cand if not (mods[i]["path"] in seenp or seenp.add(mods[i]["path"]))]
rows=[]
for i in cand:
    s=kb(R0-closure(roots,frozenset([i])))
    if s>=minkb: rows.append((s,i))
rows.sort(reverse=True)
print(f"### {route}: first-load JS {tot:.0f}KB raw. First-party modules whose lazy-loading removes >= {minkb}KB:")
for s,i in rows[:45]:
    p=mods[i]["path"].replace("[project]/src/","")
    print(f"  {s:7.1f}KB {s/tot*100:4.1f}%  {p}")
