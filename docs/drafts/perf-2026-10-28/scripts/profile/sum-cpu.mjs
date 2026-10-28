import fs from "node:fs";
for (const f of process.argv.slice(2)) {
  const o = JSON.parse(fs.readFileSync(f)); const b = Object.fromEntries(o.byBucket); const nonIdle = o.profiledMs - (b["(idle)"] ?? 0);
  const fn = (re) => Math.round(o.byFn.filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0));
  const src = (re) => Math.round(o.bySrc.filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0));
  const inc = (re) => o.inclusiveTop.filter(([k]) => re.test(k)).slice(0, 1).map(([, v]) => v)[0] ?? 0;
  const incAny = (name) => (o.inclusiveTop.find(([k]) => k.startsWith(name + " @")) ?? [0, 0])[1];
  console.log(`${f.replace("profile-cpuan-", "").replace(".json", "").padEnd(22)} busy ${nonIdle}ms | react-dom ${b["react-dom"] ?? 0} astryx ${b["astryx"] ?? 0} app ${b["app(src)"] ?? 0} next ${b["next"] ?? 0} flight ${b["flight-client"] ?? 0} stylex ${b["lib:@stylexjs/stylex"] ?? 0} gc ${b["(garbage collector)"] ?? 0} program ${b["(program)"] ?? 0} | self: readPortalWritingContext ${fn(/^readPortalWritingContext/)} useTruncation ${src(/useTruncation/)} checkVisibility(probe) ${fn(/^checkVisibility/)} | incl: safelyAttachRef ${incAny("safelyAttachRef")} commitLayoutEffectOnFiber ${incAny("commitLayoutEffectOnFiber")} renderRootSync ${incAny("renderRootSync")} beginWork ${incAny("beginWork")} Selector ${incAny("Selector")} hydrat ${incAny("hydrateRoot")}`);
}
