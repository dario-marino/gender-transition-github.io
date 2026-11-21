/* Youth Gender Dysphoria Atlas: Manhattan Institute
   Reads data/atlas_data.json (built by build/build_data.py) and data/zip3_wa_or.geojson (build/build_geo.py).
   Cell format in atlas_data.json: [patients, rate per 100,000] | "S" (fewer than 11 patients, withheld) | null. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ options & colour
  const STATES = [["WA", "Washington"], ["OR", "Oregon"]];
  const MEASURES = [["prev", "Prevalence"], ["inc", "New diagnoses"]];
  const SEXES = [["F", "Female"], ["M", "Male"], ["T", "Both"], ["R", "F÷M ratio"]];
  const BANDS = [["8-12", "8–12"], ["12-17", "12–17"], ["18-22", "18–22"]];
  const CSS = getComputedStyle(document.documentElement);
  const tok = (n) => CSS.getPropertyValue(n).trim();
  const COL = { F: tok("--female"), M: tok("--male"), T: tok("--both"), N: tok("--national"), navy: tok("--brand-navy") };
  // one-hue sequential ramps (light -> dark), one per series identity
  const RAMP = {
    F: ["#fbd6c4", "#f5a886", "#eb6834", "#bd4719", "#7f2c0c"],
    M: ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"],
    T: ["#dedaf8", "#b2a9ee", "#8274e0", "#5a48c4", "#33287a"],
  };
  // diverging for the female/male ratio: blue = male higher, gray = about equal, orange = female higher
  const RATIO_T = [0.67, 0.9, 1.1, 1.5, 2, 3];
  const RATIO_C = ["#1c5cab", "#86b6ef", "#e4e2dc", "#fbd6c4", "#f5a886", "#eb6834", "#a83f14"];

  const S = { state: "WA", measure: "prev", sex: "F", band: "12-17", period: "cum", zip: null };
  let DATA, GEO, US, YEARS;

  // ------------------------------------------------------------------ formatting
  const f0 = d3.format(",.0f"), f1 = d3.format(",.1f"), fN = d3.format(",");
  const fRate = (v) => (v < 10 ? f1(v) : f0(v));
  const fRatio = (v) => d3.format(".2f")(v) + "×";
  const oneIn = (v) => "1 in " + fN(Math.round(1e5 / v));
  const pct = (v) => d3.format(".2~f")(v / 1000) + "%";
  const bandLbl = (b) => BANDS.find((x) => x[0] === b)[1];
  const stName = (s) => DATA.states[s].name;
  const words = (b) => b === "18-22" ? { F: "young women", M: "young men", T: "young adults" } : { F: "girls", M: "boys", T: "children and teens" };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const periodLbl = (p) => (p === "cum" ? "2017–2023, all years" : String(p));
  const measLbl = () => (S.measure === "prev" ? "Prevalence" : "New diagnoses");
  const provisional = (st, measure, year) => ((DATA.meta.provisional[st] || {})[measure] || []).includes(year);

  // ------------------------------------------------------------------ data access
  const area = (st, zip) => (zip ? DATA.states[st].zips[zip].data : DATA.states[st].total);
  function cell(a, band, sex, measure, period) {
    const d = a[band][sex];
    if (period === "cum") return measure === "prev" ? d.cum : null;
    return d[measure][YEARS.indexOf(+period)];
  }
  /** -> null (no data) | {s:true} (withheld) | {v, n?} */
  function metric(a, sex, o = {}) {
    const band = o.band || S.band, measure = o.measure || S.measure, period = o.period !== undefined ? o.period : S.period;
    if (sex === "R") {
      const f = cell(a, band, "F", measure, period), m = cell(a, band, "M", measure, period);
      if (f === "S" || m === "S") return { s: true };
      if (!f || !m || !m[1]) return null;
      return { v: f[1] / m[1] };
    }
    const c = cell(a, band, sex, measure, period);
    if (c === "S") return { s: true };
    if (!c) return null;
    return { v: c[1], n: c[0] };
  }
  const fmtMetric = (m, sex) => (!m ? "–" : m.s ? "<11" : sex === "R" ? fRatio(m.v) : fRate(m.v));

  // ------------------------------------------------------------------ tooltip
  const tip = d3.select("#tip");
  function showTip(html, ev) {
    tip.html(html).style("opacity", 1);
    const r = tip.node().getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style("left", x + "px").style("top", y + "px");
  }
  const hideTip = () => tip.style("opacity", 0);

  // ------------------------------------------------------------------ controls
  function seg(id, opts, key, extra) {
    const el = d3.select(id);
    el.selectAll("button").data(opts).join("button")
      .attr("type", "button")
      .html((d) => (extra ? extra(d) : "") + d[1])
      .on("click", (ev, d) => {
        if (S[key] === d[0]) return;
        S[key] = d[0];
        if (key === "state") S.zip = null;
        fixPeriod();
        render();
      });
  }
  function syncControls() {
    for (const [id, key] of [["#c-state", "state"], ["#c-measure", "measure"], ["#c-sex", "sex"], ["#c-band", "band"]])
      d3.select(id).selectAll("button").attr("aria-pressed", (d) => String(d[0] === S[key]));
    const sel = d3.select("#c-period");
    const opts = [["cum", "All years 2017–23"]].concat(YEARS.slice().reverse().map((y) => [String(y), String(y) + (provisional(S.state, S.measure, y) ? " (provisional)" : "")]));
    sel.selectAll("option").data(opts, (d) => d[0]).join("option")
      .attr("value", (d) => d[0]).text((d) => d[1])
      .property("disabled", (d) => S.measure === "inc" && (d[0] === "cum" || d[0] === String(YEARS[0])));
    sel.property("value", String(S.period));
  }
  function fixPeriod() {
    if (S.measure === "inc" && (S.period === "cum" || +S.period === YEARS[0])) S.period = YEARS[YEARS.length - 1];
  }
  d3.select("#c-period").on("change", function () {
    S.period = this.value === "cum" ? "cum" : +this.value;
    render();
  });

  // URL hash keeps the view shareable: #WA/prev/F/12-17/cum[/986]
  function readHash() {
    const p = location.hash.replace("#", "").split("/");
    if (p.length < 5) return;
    if (DATA.states[p[0]]) S.state = p[0];
    if (MEASURES.some((m) => m[0] === p[1])) S.measure = p[1];
    if (SEXES.some((m) => m[0] === p[2])) S.sex = p[2];
    if (BANDS.some((m) => m[0] === p[3])) S.band = p[3];
    S.period = p[4] === "cum" ? "cum" : YEARS.includes(+p[4]) ? +p[4] : S.period;
    S.zip = p[5] && DATA.states[S.state].zips[p[5]] ? p[5] : null;
    fixPeriod();
  }
  function writeHash() {
    const h = [S.state, S.measure, S.sex, S.band, S.period].concat(S.zip ? [S.zip] : []).join("/");
    history.replaceState(null, "", "#" + h);
  }

  // ------------------------------------------------------------------ colour scale for the current view
  function colorScale() {
    if (S.sex === "R") return { fn: d3.scaleThreshold(RATIO_T, RATIO_C), bins: RATIO_C.map((c, i) => [c, i === 0 ? "< " + RATIO_T[0] : i === RATIO_C.length - 1 ? "≥ " + RATIO_T[i - 1] : RATIO_T[i - 1] + "–" + RATIO_T[i]]) };
    // shared across both states so colours compare when switching
    const vals = [];
    for (const st of Object.keys(DATA.states))
      for (const z of Object.keys(DATA.states[st].zips)) {
        const m = metric(area(st, z), S.sex);
        if (m && !m.s) vals.push(m.v);
      }
    const max = d3.max(vals) || 1;
    const step = d3.tickStep(0, max, 5);
    let th = d3.range(1, 5).map((i) => i * step);
    if (th[th.length - 1] >= max) th = d3.range(1, 5).map((i) => (i * max) / 5).map((v) => +d3.format(".2r")(v));
    const ramp = RAMP[S.sex];
    return {
      fn: d3.scaleThreshold(th, ramp),
      bins: ramp.map((c, i) => [c, i === 0 ? "< " + f0(th[0]) : i === ramp.length - 1 ? f0(th[i - 1]) + "+" : f0(th[i - 1]) + "–" + f0(th[i])]),
    };
  }
  const fillFor = (m, scale) => (!m ? tok("--nodata") : m.s ? "url(#hatch)" : scale.fn(m.v));

  // ------------------------------------------------------------------ map
  const W = 760, H = 500;
  let svg, gLand, gFocus, gZip, gBorder, gLabel, proj, path;
  const NEIGHBORS = { "53": "Washington", "41": "Oregon", "16": "Idaho", "06": "California", "32": "Nevada", "30": "Montana" };
  const FIPS = { WA: "53", OR: "41" };

  function initMap() {
    const box = d3.select("#map").html("");
    svg = box.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", "Map of 3-digit ZIP areas");
    const defs = svg.append("defs");
    const pat = defs.append("pattern").attr("id", "hatch").attr("patternUnits", "userSpaceOnUse").attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)");
    pat.append("rect").attr("width", 6).attr("height", 6).attr("fill", "#f1f0eb");
    pat.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke", "#a9a79f").attr("stroke-width", 2);
    svg.append("rect").attr("width", W).attr("height", H).attr("fill", "#f3f6f9").on("click", () => { if (S.zip) { S.zip = null; render(); } });
    gLand = svg.append("g");
    gFocus = svg.append("g");
    gZip = svg.append("g");
    gBorder = svg.append("g");
    gLabel = svg.append("g");
    proj = d3.geoConicConformal().parallels([42, 49]).rotate([120.5, 0]);
    path = d3.geoPath(proj);
  }

  function renderMap(scale) {
    const focusFeats = GEO.features.filter((f) => f.properties.state === S.state);
    proj.fitExtent([[14, 14], [W - 14, H - 14]], { type: "FeatureCollection", features: focusFeats });
    const t = svg.transition().duration(650);

    if (US) {
      const states = topojson.feature(US, US.objects.states).features.filter((f) => NEIGHBORS[f.id]);
      gLand.selectAll("path").data(states, (d) => d.id).join("path").attr("class", "land").transition(t).attr("d", path);
      gFocus.selectAll("path").data(states.filter((f) => f.id === FIPS[S.state]), (d) => d.id).join("path").attr("class", "focus-land").transition(t).attr("d", path);
      gBorder.selectAll("path").data([topojson.mesh(US, US.objects.states, (a, b) => a !== b)]).join("path").attr("class", "border").transition(t).attr("d", path);
      // name the other state at the map edge it sits on
      const other = S.state === "WA" ? "OR" : "WA";
      gLabel.selectAll("text.stname").data([other], (d) => d).join("text")
        .attr("class", "stname").attr("text-anchor", "middle").text((d) => stName(d))
        .transition(t).attr("x", W / 2 - 60).attr("y", other === "OR" ? H - 10 : 22);
    }

    gZip.selectAll("path.zip").data(GEO.features, (d) => d.properties.state + d.properties.zip3).join((enter) =>
      enter.append("path").attr("class", "zip").attr("tabindex", 0).attr("role", "button")
        .on("mousemove", (ev, d) => showTip(zipTip(d), ev))
        .on("mouseleave", () => { hideTip(); hl(null); })
        .on("mouseenter", (ev, d) => hl(d.properties.state === S.state ? d.properties.zip3 : null))
        .on("click", (ev, d) => pickZip(d.properties.state, d.properties.zip3))
        .on("keydown", (ev, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pickZip(d.properties.state, d.properties.zip3); } })
    )
      .classed("other", (d) => d.properties.state !== S.state)
      .classed("sel", (d) => d.properties.state === S.state && d.properties.zip3 === S.zip)
      .attr("aria-label", (d) => { const z = DATA.states[d.properties.state].zips[d.properties.zip3]; return `${d.properties.zip3} ${z.label}: ${fmtMetric(metric(z.data, S.sex), S.sex)}`; })
      .transition(t)
      .attr("d", path)
      .attr("fill", (d) => fillFor(metric(area(d.properties.state, d.properties.zip3), S.sex), scale));
    gZip.selectAll("path.sel").raise();

    // place labels for the larger areas of the focus state
    // biggest areas first; skip a label that would collide with one already placed
    const lab = [];
    for (const f of focusFeats.filter((f) => path.area(f) > 1800).sort((a, b) => path.area(b) - path.area(a))) {
      const [cx, cy] = path.centroid(f);
      if (lab.every((g) => { const [gx, gy] = path.centroid(g); return Math.abs(gx - cx) > 80 || Math.abs(gy - cy) > 16; })) lab.push(f);
    }
    gLabel.selectAll("text.place").data(lab, (d) => d.properties.zip3).join("text").attr("class", "place").attr("text-anchor", "middle")
      .text((d) => DATA.states[S.state].zips[d.properties.zip3].label)
      .transition(t).attr("x", (d) => path.centroid(d)[0]).attr("y", (d) => path.centroid(d)[1] + 4);
  }
  function zipTip(d) {
    const st = d.properties.state, z = DATA.states[st].zips[d.properties.zip3];
    const rows = [["F", "Female"], ["M", "Male"], ["T", "Both"]].map(([k, l]) => {
      const m = metric(z.data, k);
      return `<div class="row"><span><i class="sw" style="background:${COL[k]}"></i>${l}</span><span>${fmtMetric(m, k)}${m && m.n ? ` <span class="m">(${fN(m.n)})</span>` : ""}</span></div>`;
    }).join("");
    const r = metric(z.data, "R");
    return `<b>${d.properties.zip3} ${z.label}</b> <span class="m">${stName(st)}</span><br><span class="m">${measLbl()} per 100,000 · ages ${bandLbl(S.band)} · ${periodLbl(S.period)}</span>${rows}<div class="row"><span>Female ÷ male</span><span>${fmtMetric(r, "R")}</span></div>${st !== S.state ? `<span class="m">Click to switch to ${stName(st)}</span>` : ""}`;
  }

  function pickZip(st, zip) {
    if (st !== S.state) { S.state = st; S.zip = zip; }
    else S.zip = S.zip === zip ? null : zip;
    render();
  }
  function hl(zip) {
    d3.selectAll(".rank .row").classed("hl", (d) => d.zip === zip);
  }

  function renderLegend(scale) {
    const L = d3.select("#legend").html("");
    L.append("div").attr("class", "title").text(S.sex === "R" ? "Female rate ÷ male rate (1 = equal)" : `${measLbl()} per 100,000 ${words(S.band)[S.sex]}`);
    const ramp = L.append("div").attr("class", "ramp");
    for (const [c, t] of scale.bins) { const s = ramp.append("span"); s.append("i").style("background", c); s.append("b").style("font-weight", 400).text(t); }
    L.append("span").attr("class", "key").html(`<i style="background:repeating-linear-gradient(45deg,#f1f0eb 0 3px,#a9a79f 3px 5px)"></i>Fewer than 11 patients`);
  }

  // ------------------------------------------------------------------ headline counters
  function renderCounters() {
    const a = area(S.state), nat = DATA.national, w = words(S.band), b = bandLbl(S.band);
    const F = metric(a, "F", { measure: "prev", period: "cum" }), M = metric(a, "M", { measure: "prev", period: "cum" });
    const NF = metric(nat, "F", { measure: "prev", period: "cum" });
    const f17 = metric(a, "F", { measure: "prev", period: 2017 }), f22 = metric(a, "F", { measure: "prev", period: 2022 });
    const m17 = metric(a, "M", { measure: "prev", period: 2017 }), m22 = metric(a, "M", { measure: "prev", period: 2022 });
    const r = F.v / M.v;
    const tiles = [
      { c: COL.F, big: oneIn(F.v), txt: `<b>${cap(w.F)} ages ${b}</b> in ${stName(S.state)} had a gender dysphoria diagnosis at some point in 2017–2023, <b>${d3.format(".1f")(F.v / NF.v)}×</b> the national rate.` },
      { c: COL.M, big: oneIn(M.v), txt: `<b>${cap(w.M)} ages ${b}</b> in ${stName(S.state)} had a diagnosis in 2017–2023 (${pct(M.v)}).` },
      { c: COL.navy, big: (r >= 1 ? r : 1 / r).toFixed(1) + "×", txt: r >= 1 ? `<b>${cap(w.F)}</b> were diagnosed at ${(r).toFixed(1)} times the rate of ${w.M}.` : `<b>${cap(w.M)}</b> were diagnosed at ${(1 / r).toFixed(1)} times the rate of ${w.F}.` },
      { c: COL.F, big: (f22.v / f17.v).toFixed(1) + "×", txt: `Rise in the yearly rate among <b>${w.F}</b> from 2017 to 2022 (${w.M}: ${(m22.v / m17.v).toFixed(1)}×).` },
    ];
    d3.select("#counters").selectAll("div.counter").data(tiles).join("div").attr("class", "counter")
      .style("--c", (d) => d.c).html((d) => `<div class="big">${d.big}</div><div class="txt">${d.txt}</div>`);
  }

  // ------------------------------------------------------------------ detail panel
  function renderPanel() {
    const P = d3.select("#panel").html("");
    const st = S.state, z = S.zip ? DATA.states[st].zips[S.zip] : null, a = area(st, S.zip), w = words(S.band);
    P.append("h3").text(z ? `${S.zip} · ${z.label}` : `${stName(st)}, statewide`);
    P.append("div").attr("class", "area-sub").text(z ? z.area : "All youth in the claims data, including those without a ZIP on file");
    const m = metric(a, S.sex);
    const hero = P.append("div").attr("class", "hero");
    hero.append("span").attr("class", "num").style("color", S.sex === "R" ? COL.navy : COL[S.sex]).text(fmtMetric(m, S.sex));
    hero.append("span").attr("class", "unit").text(S.sex === "R" ? "female rate ÷ male rate" : `per 100,000 ${w[S.sex]}`);
    let plain = "";
    if (!m) plain = "No data for this selection.";
    else if (m.s) plain = "Fewer than 11 patients, so the figure is withheld.";
    else if (S.sex === "R") plain = m.v >= 1 ? `${cap(w.F)} were diagnosed at ${m.v.toFixed(1)} times the rate of ${w.M}.` : `${cap(w.M)} were diagnosed at ${(1 / m.v).toFixed(1)} times the rate of ${w.F}.`;
    else plain = `About ${oneIn(m.v)} (${pct(m.v)})${m.n ? `: ${fN(m.n)} ${S.measure === "inc" ? "newly diagnosed " : ""}${w[S.sex]}` : ""}.`;
    P.append("p").attr("class", "plain" + (!m || m.s ? " muted" : "")).text(plain);
    P.append("div").attr("class", "area-sub").text(`${measLbl()} · ages ${bandLbl(S.band)} · ${periodLbl(S.period)}${S.period !== "cum" && provisional(st, S.measure, +S.period) ? " (provisional)" : ""}`);

    // comparison bars
    const rows = [["F", "Female", a], ["M", "Male", a], ["T", "Both", a]];
    if (z && S.sex !== "R") rows.push([S.sex, "Statewide", area(st), true]);
    const vals = rows.map((r) => metric(r[2], r[0]));
    const mx = d3.max(vals, (v) => (v && !v.s ? v.v : 0)) || 1;
    const C = P.append("div").attr("class", "cmp");
    rows.forEach((r, i) => {
      const v = vals[i];
      C.append("div").attr("class", "k").text(r[1]);
      C.append("div").attr("class", "bar").append("i").style("width", v && !v.s ? (v.v / mx) * 100 + "%" : "0").style("background", r[3] ? COL.navy : COL[r[0]]);
      C.append("div").attr("class", "v").text(fmtMetric(v, r[0]));
    });

    P.append("div").attr("class", "mini-title").text(`${measLbl()} by year, ages ${bandLbl(S.band)}`);
    const series = ["F", "M"].map((k) => ({ key: k, name: k === "F" ? "Female" : "Male", color: COL[k], values: yearVals(a, S.band, k, S.measure, st) }));
    lineChart(P.append("div").attr("class", "chart"), series, { width: 360, height: 190 });
    if (z) P.append("button").attr("class", "reset").attr("type", "button").text(`← Back to ${stName(st)} statewide`).on("click", () => { S.zip = null; render(); });
  }

  function yearVals(a, band, sex, measure, st) {
    return YEARS.map((y) => {
      const m = metric(a, sex, { band, measure, period: y });
      return { y, v: m && !m.s ? m.v : null, s: !!(m && m.s), n: m && m.n, prov: st ? provisional(st, measure, y) : false };
    }).filter((d) => !(measure === "inc" && d.y === YEARS[0]));
  }

  // ------------------------------------------------------------------ ranked list + table
  function renderRank() {
    const st = S.state, zips = DATA.states[st].zips, w = words(S.band);
    const rows = Object.keys(zips).map((zip) => ({ zip, label: zips[zip].label, m: metric(zips[zip].data, S.sex) }));
    rows.sort((a, b) => (b.m && !b.m.s ? b.m.v : -1) - (a.m && !a.m.s ? a.m.v : -1));
    const ref = metric(area(st), S.sex);
    const mx = d3.max(rows, (r) => (r.m && !r.m.s ? r.m.v : 0)) * 1.04;
    const x = (v) => (Math.max(0, v) / Math.max(mx, ref && !ref.s ? ref.v : 0)) * 100;
    d3.select("#rank-title").text(S.sex === "R" ? `ZIP areas ranked by female ÷ male rate, ages ${bandLbl(S.band)}` : `ZIP areas ranked: ${measLbl().toLowerCase()} among ${w[S.sex]} ages ${bandLbl(S.band)}, per 100,000`);
    d3.select("#rank-key").html(`<span class="refkey"></span>${S.sex === "R" ? "Line = statewide ratio" : `Line = ${stName(st)} statewide (${fmtMetric(ref, S.sex)})`} · ${periodLbl(S.period)}`);
    const color = (r) => (S.sex === "R" ? (r.m && r.m.v < 1 ? COL.M : COL.F) : COL[S.sex]);
    const R = d3.select("#rank").selectAll("div.row").data(rows, (d) => d.zip).join((e) => {
      const r = e.append("div").attr("class", "row").attr("tabindex", 0);
      r.append("div").attr("class", "nm");
      const t = r.append("div").attr("class", "track");
      t.append("i");
      t.append("span").attr("class", "ref");
      r.append("div").attr("class", "v");
      return r;
    });
    R.order().classed("sel", (d) => d.zip === S.zip)
      .on("click", (ev, d) => pickZip(st, d.zip))
      .on("keydown", (ev, d) => { if (ev.key === "Enter") pickZip(st, d.zip); })
      .on("mouseenter", (ev, d) => gZip.selectAll("path.zip").filter((f) => f.properties.state === st && f.properties.zip3 === d.zip).raise().style("stroke", "#0b0b0b").style("stroke-width", 2))
      .on("mouseleave", () => { gZip.selectAll("path.zip").style("stroke", null).style("stroke-width", null); gZip.selectAll("path.sel").raise(); });
    R.select(".nm").html((d) => `<b>${d.zip}</b>${d.label}`);
    R.select(".track i").style("background", color).transition().duration(500).style("width", (d) => (d.m && !d.m.s ? x(d.m.v) : 0) + "%");
    R.select(".track .ref").style("display", ref && !ref.s ? null : "none").style("left", ref && !ref.s ? x(ref.v) + "%" : 0);
    R.select(".v").text((d) => fmtMetric(d.m, S.sex));

    // table view
    const cols = [["F", "Female"], ["M", "Male"], ["T", "Both"]];
    const tcell = (m, k) => (!m ? "–" : m.s ? "<11" : fRate(m.v) + (m.n ? ` (${fN(m.n)})` : ""));
    const trow = (zip, label, a) => `<tr><td>${zip}</td><td>${label}</td>${cols.map(([k]) => `<td>${tcell(metric(a, k), k)}</td>`).join("")}<td>${fmtMetric(metric(a, "R"), "R")}</td></tr>`;
    d3.select("#zip-table").html(`<table><thead><tr><th>ZIP3</th><th>Area</th>${cols.map(([, l]) => `<th>${l} per 100k (patients)</th>`).join("")}<th>F ÷ M</th></tr></thead><tbody>${trow("", stName(st) + " statewide", area(st))}${Object.keys(zips).map((z) => trow(z, zips[z].label, zips[z].data)).join("")}</tbody></table><p class="note">${measLbl()}, ages ${bandLbl(S.band)}, ${periodLbl(S.period)}. &lt;11 = fewer than 11 patients, withheld.</p>`);
  }

  // ------------------------------------------------------------------ line chart (shared by panel + trends)
  function lineChart(container, series, o) {
    const W = o.width || 360, H = o.height || 220, m = { t: 10, r: 14, b: 24, l: 44 };
    const years = series[0].values.map((d) => d.y);
    const yMax = o.yMax || d3.max(series, (s) => d3.max(s.values, (d) => d.v)) || 1;
    const x = d3.scalePoint(years, [m.l, W - m.r]).padding(0.15);
    const y = d3.scaleLinear([0, yMax * 1.08], [H - m.b, m.t]).nice();
    const svg = container.append("svg").attr("viewBox", `0 0 ${W} ${H}`);
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")).tickSize(0).tickPadding(6)).select(".domain").remove();
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat((d) => (years.length > 6 && W < 330 ? "'" + String(d).slice(2) : d)));
    svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", tok("--axis"));
    const line = d3.line().defined((d) => d.v != null).x((d) => x(d.y)).y((d) => y(d.v));
    for (const s of series) {
      const g = svg.append("g").attr("opacity", s.faint ? 0.45 : 1);
      const firm = s.values.map((d) => (d.prov ? { ...d, v: null } : d));
      g.append("path").attr("d", line(firm)).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", s.faint ? 1.5 : 2.25).attr("stroke-linejoin", "round");
      // provisional tail: dashed from the last firm point
      const pi = s.values.findIndex((d) => d.prov);
      if (pi > 0 && s.values[pi].v != null && s.values[pi - 1].v != null)
        g.append("path").attr("d", line(s.values.slice(pi - 1))).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", s.faint ? 1.5 : 2.25).attr("stroke-dasharray", "5 4");
      if (!s.faint)
        g.selectAll("circle").data(s.values.filter((d) => d.v != null)).join("circle")
          .attr("cx", (d) => x(d.y)).attr("cy", (d) => y(d.v)).attr("r", 3.6)
          .attr("fill", (d) => (d.prov ? "#fff" : s.color)).attr("stroke", (d) => (d.prov ? s.color : "#fff")).attr("stroke-width", (d) => (d.prov ? 1.8 : 1.5));
      // withheld years
      g.selectAll("text.sup").data(s.faint ? [] : s.values.filter((d) => d.s)).join("text").attr("class", "sup")
        .attr("x", (d) => x(d.y)).attr("y", y(0) - 4).attr("text-anchor", "middle").attr("font-size", 9.5).attr("fill", tok("--muted")).text("<11");
    }
    // hover: crosshair + tooltip
    const rule = svg.append("line").attr("y1", m.t).attr("y2", H - m.b).attr("stroke", tok("--ink-2")).attr("stroke-width", 1).attr("opacity", 0);
    svg.append("rect").attr("x", m.l).attr("y", 0).attr("width", W - m.l - m.r).attr("height", H).attr("fill", "transparent")
      .on("mousemove", (ev) => {
        const [px] = d3.pointer(ev);
        const yr = years.reduce((a, b) => (Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a));
        rule.attr("x1", x(yr)).attr("x2", x(yr)).attr("opacity", 0.5);
        const rows = series.map((s) => {
          const d = s.values.find((v) => v.y === yr);
          const val = !d ? "–" : d.s ? "<11" : d.v == null ? "–" : fRate(d.v);
          return `<div class="row"><span><i class="sw" style="background:${s.color};opacity:${s.faint ? 0.5 : 1}"></i>${s.name}</span><span>${val}${d && d.n ? ` <span class="m">(${fN(d.n)})</span>` : ""}</span></div>`;
        }).join("");
        const prov = series.some((s) => (s.values.find((v) => v.y === yr) || {}).prov);
        showTip(`<b>${yr}</b>${prov ? ' <span class="m">provisional</span>' : ""}<br><span class="m">per 100,000 (patients)</span>${rows}`, ev);
      })
      .on("mouseleave", () => { rule.attr("opacity", 0); hideTip(); });
    return svg;
  }

  // ------------------------------------------------------------------ statewide trends (small multiples)
  function renderTrends() {
    const st = S.state, a = area(st), nat = DATA.national;
    d3.select("#trend-h").text(`${stName(st)} trend, by sex and age`);
    d3.select("#trend-sub").text(S.measure === "prev"
      ? `Share of youth with a gender dysphoria diagnosis in each year, per 100,000 of the same sex and age. Faint lines: the whole national claims database.`
      : `Youth diagnosed for the first time in each year, per 100,000 of the same sex and age. Faint lines: the whole national claims database.`);
    d3.select("#trend-key").html(`<span><i style="background:${COL.F}"></i>Female</span><span><i style="background:${COL.M}"></i>Male</span><span><i style="background:${COL.F};opacity:.45"></i><i style="background:${COL.M};opacity:.45;margin-left:-4px"></i>National</span>`);
    const all = BANDS.map(([b]) => [
      { name: `${stName(st)} female`, color: COL.F, values: yearVals(a, b, "F", S.measure, st) },
      { name: `${stName(st)} male`, color: COL.M, values: yearVals(a, b, "M", S.measure, st) },
      { name: "National female", color: COL.F, faint: true, values: yearVals(nat, b, "F", S.measure) },
      { name: "National male", color: COL.M, faint: true, values: yearVals(nat, b, "M", S.measure) },
    ]);
    const yMax = d3.max(all.flat(), (s) => d3.max(s.values, (d) => d.v));
    const box = d3.select("#trend-charts").html("");
    BANDS.forEach(([b, lbl], i) => {
      const c = box.append("div").attr("class", "chart");
      c.append("h4").text(`Ages ${lbl}`);
      lineChart(c, all[i], { width: 380, height: 250, yMax });
    });
    d3.select("#trend-note").text(DATA.meta.provisional[st] && DATA.meta.provisional[st][S.measure]
      ? "2023 is provisional (dashed line, open marker): late-2023 Washington claims are incomplete, which understates 2023 prevalence."
      : "All panels share one scale so age groups can be compared directly.");
  }

  // ------------------------------------------------------------------ grouped bars by age
  function renderAge() {
    const st = S.state, a = area(st), nat = DATA.national;
    d3.select("#age-sub").text(`${measLbl()} per 100,000 youth of the same sex and age, ${periodLbl(S.period)}. Gray ticks mark the national rate.`);
    d3.select("#age-key").html(`<span><i class="sw" style="background:${COL.F}"></i>Female</span><span><i class="sw" style="background:${COL.M}"></i>Male</span><span><i style="background:${COL.N};height:3px"></i>National</span>`);
    const data = BANDS.map(([b, lbl]) => ({ b, lbl, bars: ["F", "M"].map((k) => ({ k, m: metric(a, k, { band: b }), n: metric(nat, k, { band: b }) })) }));
    const W = 1100, H = 330, m = { t: 22, r: 10, b: 30, l: 50 };
    const x0 = d3.scaleBand(data.map((d) => d.lbl), [m.l, W - m.r]).paddingInner(0.28).paddingOuter(0.12);
    const x1 = d3.scaleBand(["F", "M"], [0, x0.bandwidth()]).paddingInner(0.04);
    const yMax = d3.max(data, (d) => d3.max(d.bars, (b) => Math.max(b.m && !b.m.s ? b.m.v : 0, b.n && !b.n.s ? b.n.v : 0))) || 1;
    const y = d3.scaleLinear([0, yMax * 1.1], [H - m.b, m.t]).nice();
    const box = d3.select("#age-chart").html("");
    const svg = box.append("svg").attr("viewBox", `0 0 ${W} ${H}`);
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(",")).tickSize(0).tickPadding(6)).select(".domain").remove();
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x0).tickSize(0).tickPadding(10).tickFormat((d) => "Ages " + d)).selectAll("text").style("font-size", "13px").style("fill", tok("--ink-2"));
    const g = svg.selectAll("g.grp").data(data).join("g").attr("transform", (d) => `translate(${x0(d.lbl)},0)`);
    const bar = g.selectAll("g.b").data((d) => d.bars.map((b) => ({ ...b, band: d.b }))).join("g");
    const rr = 4;
    bar.append("path").attr("fill", (d) => COL[d.k]).attr("d", (d) => {
      const v = d.m && !d.m.s ? d.m.v : 0, x = x1(d.k), w = x1.bandwidth(), top = y(v), base = y(0), r = Math.min(rr, base - top);
      return v ? `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z` : "";
    });
    bar.append("text").attr("x", (d) => x1(d.k) + x1.bandwidth() / 2).attr("y", (d) => y(d.m && !d.m.s ? d.m.v : 0) - 6).attr("text-anchor", "middle")
      .attr("font-size", 12.5).attr("font-weight", 600).attr("fill", tok("--ink")).text((d) => fmtMetric(d.m, d.k));
    bar.append("line").attr("x1", (d) => x1(d.k) + 6).attr("x2", (d) => x1(d.k) + x1.bandwidth() - 6)
      .attr("y1", (d) => y(d.n && !d.n.s ? d.n.v : 0)).attr("y2", (d) => y(d.n && !d.n.s ? d.n.v : 0))
      .attr("stroke", "#fff").attr("stroke-width", 5).clone(true).attr("stroke", COL.N).attr("stroke-width", 3);
    bar.append("rect").attr("x", (d) => x1(d.k)).attr("width", x1.bandwidth()).attr("y", m.t).attr("height", H - m.b - m.t).attr("fill", "transparent")
      .on("mousemove", (ev, d) => showTip(`<b>${d.k === "F" ? "Female" : "Male"}, ages ${bandLbl(d.band)}</b><br><span class="m">${measLbl()} per 100,000 · ${periodLbl(S.period)}</span><div class="row"><span>${stName(st)}</span><span>${fmtMetric(d.m, d.k)}${d.m && d.m.n ? ` <span class="m">(${fN(d.m.n)})</span>` : ""}</span></div><div class="row"><span>National</span><span>${fmtMetric(d.n, d.k)}</span></div>`, ev))
      .on("mouseleave", hideTip);
  }

  // ------------------------------------------------------------------ render all
  function render() {
    syncControls();
    writeHash();
    const scale = colorScale();
    const w = words(S.band);
    d3.select("#map-title").text(S.sex === "R"
      ? `How much more often female than male youth were diagnosed, ages ${bandLbl(S.band)}`
      : `${measLbl()} among ${w[S.sex]} ages ${bandLbl(S.band)}, ${stName(S.state)}`);
    d3.select("#map-sub").text(`${periodLbl(S.period)}${S.period !== "cum" && provisional(S.state, S.measure, +S.period) ? " (provisional: late-2023 claims incomplete)" : ""} · ${S.sex === "R" ? "female rate ÷ male rate" : "per 100,000 youth of the same sex and age in the claims data"}`);
    renderMap(scale);
    renderLegend(scale);
    renderCounters();
    renderPanel();
    renderRank();
    renderTrends();
    renderAge();
  }

  // ------------------------------------------------------------------ boot
  Promise.all([
    d3.json("data/atlas_data.json"),
    d3.json("data/zip3_wa_or.geojson"),
    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json").catch(() => null),
  ]).then(([data, geo, us]) => {
    DATA = data; GEO = geo; US = us; YEARS = data.meta.years;
    seg("#c-state", STATES, "state");
    seg("#c-measure", MEASURES, "measure");
    seg("#c-sex", SEXES, "sex", (d) => (d[0] === "R" ? "" : `<span class="dot" style="background:${COL[d[0]]}"></span>`));
    seg("#c-band", BANDS, "band");
    readHash();
    initMap();
    render();
    let rt;
    addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(hideTip, 100); });
  }).catch((err) => {
    d3.select("#map").html(`<div class="loading">Could not load the data (${err.message}). If you opened this file directly, serve the folder over http (e.g. GitHub Pages).</div>`);
    console.error(err);
  });
})();
