(function () {
  "use strict";

  var SLOTS = 18;            // 1:00 ~ 10:00 (오후), 30분 단위
  var START = 13 * 60;       // 13:00
  var ROOMS = [
    { k: "band", n: "합주실", c: "b" },
    { k: "drum", n: "드럼연습실", c: "d" }
  ];

  var cfg = window.APP_CONFIG || {};
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    cfg.SUPABASE_URL.indexOf("YOUR-PROJECT") === -1 && cfg.SUPABASE_ANON_KEY.indexOf("YOUR-") === -1 && window.supabase;
  var sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  var state = {
    day: "", rooms: emptyRooms(), loaded: false, loadError: "",
    session: null, isAdmin: false, live: false,
    editing: false, draft: null, sel: {}, busy: false, status: "",
    showLogin: false, loginMsg: "", who: "",
    queued: null, range: null, inline: null, inlineBusy: false, flash: ""
  };
  var channel = null;

  function emptyRooms() { return { band: {}, drum: {} }; }

  function kst() {
    var f = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    });
    var p = {};
    f.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + "-" + p.month + "-" + p.day, min: (+p.hour) * 60 + (+p.minute), y: +p.year, m: +p.month, d: +p.day };
  }
  function label(i) {
    var s = START + i * 30, e = s + 30;
    function f(t) { var h = Math.floor(t / 60) % 12 || 12; return h + ":" + (t % 60 ? "30" : "00"); }
    return f(s) + "~" + f(e);
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function btn(cls, txt, fn) { var b = el("button", cls, txt); b.type = "button"; b.onclick = fn; return b; }

  // ---------- data ----------
  var lessonsDay = "";
  // 오늘 요일의 정기 수업을 예약표에 넣기 (하루 한 번, 서버에서 중복 방지)
  function applyLessons(day) {
    if (lessonsDay === day) return Promise.resolve();
    lessonsDay = day;
    return Promise.resolve(sb.rpc("apply_today_lessons")).then(function () {}, function () {});
  }
  function load() {
    if (!sb) return Promise.resolve();
    var day = kst().date;
    return applyLessons(day).then(function () { return sb.from("reservations").select("room,slot,name").eq("day", day).then(function (res) {
      if (res.error) { state.loadError = "예약을 불러오지 못했어요. 잠시 후 새로고침해 주세요."; render(); return; }
      var rooms = emptyRooms();
      (res.data || []).forEach(function (r) { if (rooms[r.room]) rooms[r.room][r.slot] = r.name; });
      state.day = day; state.rooms = rooms; state.loaded = true; state.loadError = "";
      if (!state.editing && !state.inline) render();
    }); });
  }

  function subscribe() {
    if (!sb) return;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("reservations-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, function () { load(); })
      .subscribe(function (status) {
        state.live = status === "SUBSCRIBED";
        if (!state.editing) renderHeaderLive();
      });
  }

  function checkAdmin() {
    if (!sb || !state.session) { state.isAdmin = false; return Promise.resolve(); }
    var email = state.session.user && state.session.user.email;
    return sb.from("admins").select("email").eq("email", email).maybeSingle().then(function (res) {
      state.isAdmin = !!(res.data && !res.error);
    });
  }

  // ---------- render ----------
  function render() {
    var k = kst();
    if (state.loaded && state.day !== k.date && !state.editing) { state.rooms = emptyRooms(); state.day = k.date; load(); }
    var rooms = state.editing ? state.draft : state.rooms;
    var root = document.getElementById("root");
    root.textContent = "";
    root.classList.toggle("editing", state.editing);
    document.body.classList.toggle("has-bar", state.editing);

    var hd = el("header"), l = el("div");
    l.appendChild(el("div", "eyebrow", "PRACTICE ROOM BOOKING"));
    l.appendChild(el("h1", null, "합주실 · 드럼연습실 예약"));
    var dt = el("div", "date");
    var lv = el("span", "chip live" + (state.live ? "" : " off"), state.live ? "실시간" : "자동 새로고침");
    lv.id = "livechip";
    if (sb) dt.appendChild(lv);
    l.appendChild(dt);
    hd.appendChild(l);

    var tools = el("div", "tools");
    hd.appendChild(tools);
    root.appendChild(hd);

    if (state.flash) {
      root.appendChild(el("p", "notice warn", state.flash));
    }
    if (!sb) {
      root.appendChild(el("p", "notice warn", "아직 Supabase가 연결되지 않았어요. config.js에 프로젝트 주소와 anon key를 넣어 주세요. (README 참고)"));
    } else if (state.loadError) {
      root.appendChild(el("p", "notice warn", state.loadError));
    } else if (!state.loaded) {
      root.appendChild(el("p", "notice", "예약 현황을 불러오는 중…"));
    }

    var sh = el("div", "sheet");
    sh.setAttribute("aria-label", "오늘 예약표");
    sh.appendChild(el("div", "h t", "시간 (오후)"));
    ROOMS.forEach(function (r) { sh.appendChild(el("div", "h " + r.k, r.n)); });
    for (var i = 0; i < SLOTS; i++) {
      var hour = i > 0 && i % 2 === 0, alt = Math.floor(i / 2) % 2 === 1;
      var now = k.min >= START + i * 30 && k.min < START + i * 30 + 30;
      var t = el("div", "time" + (alt ? " alt" : "") + (hour ? " hour" : "") + (now ? " now" : ""));
      t.appendChild(el("span", null, label(i)));
      if (now) t.appendChild(el("span", "now-tag", "지금"));
      sh.appendChild(t);
      ROOMS.forEach(function (r) { sh.appendChild(cell(r, i, rooms, hour)); });
    }
    root.appendChild(sh);

    var gap = el("div"); gap.style.height = "12px"; root.appendChild(gap);

    if (sb) root.appendChild(adminArea());
    renderBar();
  }

  function cell(r, i, rooms, hour) {
    var v = rooms[r.k][i] || "", prev = i > 0 ? (rooms[r.k][i - 1] || "") : "";
    if (state.inline && state.inline.room === r.k) {
      if (state.inline.slot === i) return inlineCell(r, i, v, hour);
      if (i > state.inline.slot && i <= state.inline.slot + (state.inline.span || 0)) return previewCell(r, i, hour);
    }
    var c = el("button", "cell " + r.c + (v ? " on" : "") + (hour ? " hour" : "") + (v && v === prev ? " cont" : "") + (v.indexOf("수업") !== -1 ? " lesson" : ""));
    c.type = "button";
    c.setAttribute("aria-label", r.n + " " + label(i) + " " + (v || "비어 있음"));
    if (v) c.appendChild(el("span", "nm", v));
    var key = r.k + ":" + i;
    if (state.editing) {
      if (state.sel[key]) c.classList.add("sel");
      c.setAttribute("aria-pressed", state.sel[key] ? "true" : "false");
      c.onclick = function () { if (state.sel[key]) delete state.sel[key]; else state.sel[key] = 1; render(); };
    } else if (state.isAdmin) {
      c.classList.add("quick");
      c.title = "눌러서 입력 · 드래그해서 여러 칸 선택";
      c.dataset.room = r.k; c.dataset.slot = i;
      if (inRange(r.k, i)) c.classList.add("rsel");
      c.addEventListener("pointerdown", function (e) { dragStart(e, r.k, i); });
      c.onclick = function (e) {
        if (drag.suppress) { drag.suppress = false; return; }
        if (e.shiftKey && state.range) { extendRange(r.k, i); return; }
        clearRange(true);
        selectCell({ room: r.k, slot: i });
      };
    } else {
      c.tabIndex = -1;
    }
    return c;
  }

  // ---------- drag select & delete (admin, mouse) ----------
  var drag = { on: false, moved: false, suppress: false, anchor: null };
  function roomIdx(k) { return k === "band" ? 0 : 1; }
  function inRange(k, i) {
    var g = state.range; if (!g) return false;
    var ri = roomIdx(k);
    return ri >= g.r0 && ri <= g.r1 && i >= g.s0 && i <= g.s1;
  }
  function setRange(a, b) {
    var ra = roomIdx(a.room), rb = roomIdx(b.room);
    state.range = { r0: Math.min(ra, rb), r1: Math.max(ra, rb), s0: Math.min(a.slot, b.slot), s1: Math.max(a.slot, b.slot), anchor: a };
    paintRange();
  }
  function extendRange(k, i) { setRange(state.range.anchor, { room: k, slot: i }); }
  function paintRange() {
    document.querySelectorAll(".cell.quick").forEach(function (c) {
      c.classList.toggle("rsel", inRange(c.dataset.room, +c.dataset.slot));
    });
  }
  function clearRange(silent) {
    if (!state.range) return;
    state.range = null;
    if (!silent) paintRange();
  }
  function dragStart(e, k, i) {
    if (e.pointerType !== "mouse" || e.button !== 0 || e.shiftKey) return;
    drag.on = true; drag.moved = false; drag.anchor = { room: k, slot: i };
  }
  document.addEventListener("pointermove", function (e) {
    if (!drag.on) return;
    var t = document.elementFromPoint(e.clientX, e.clientY);
    var c = t && t.closest ? t.closest(".cell.quick") : null;
    if (!c) return;
    var tgt = { room: c.dataset.room, slot: +c.dataset.slot };
    if (!drag.moved && tgt.room === drag.anchor.room && tgt.slot === drag.anchor.slot) return;
    if (!drag.moved) {
      drag.moved = true;
      if (state.inline) { var inp = document.getElementById("inline-input"); if (inp) inp.blur(); }
    }
    setRange(drag.anchor, tgt);
  });
  document.addEventListener("pointerup", function () {
    if (!drag.on) return;
    drag.on = false;
    if (drag.moved) {
      drag.suppress = true; // 드래그 끝의 click 은 입력창을 열지 않음
      setTimeout(function () { drag.suppress = false; }, 0);
      toast(rangeCount() + "칸 선택 · Delete 키로 지우기");
    }
  });
  document.addEventListener("pointerdown", function (e) {
    if (state.range && !(e.target.closest && (e.target.closest(".cell.quick") || e.target.closest(".toast")))) clearRange();
  });
  document.addEventListener("keydown", function (e) {
    if (!state.range || state.inline || state.editing) return;
    var a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteRange(); }
    else if (e.key === "Escape") { clearRange(); }
  });
  function rangeCount() { var g = state.range; return g ? (g.r1 - g.r0 + 1) * (g.s1 - g.s0 + 1) : 0; }
  function deleteRange() {
    var g = state.range; if (!g || !sb) return;
    var day = kst().date;
    if (state.day !== day) { state.rooms = emptyRooms(); state.day = day; }
    var removed = []; // {room, slot, name}
    for (var ri = g.r0; ri <= g.r1; ri++) {
      var k = ROOMS[ri].k;
      for (var i = g.s0; i <= g.s1; i++) if (state.rooms[k][i]) removed.push({ room: k, slot: i, name: state.rooms[k][i] });
    }
    state.range = null;
    if (!removed.length) { paintRange(); toast("지울 예약이 없어요"); return; }
    removed.forEach(function (x) { delete state.rooms[x.room][x.slot]; });
    render();
    var jobs = ROOMS.map(function (r) {
      var slots = removed.filter(function (x) { return x.room === r.k; }).map(function (x) { return x.slot; });
      return slots.length ? sb.from("reservations").delete().eq("day", day).eq("room", r.k).in("slot", slots) : null;
    }).filter(Boolean);
    Promise.all(jobs).then(function (res) {
      var err = res.filter(function (x) { return x.error; })[0];
      if (err) {
        removed.forEach(function (x) { state.rooms[x.room][x.slot] = x.name; });
        render();
        toast(/row-level security|permission/i.test(err.error.message) ? "지울 권한이 없어요. 관리자로 로그인했는지 확인해 주세요." : "지우지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      toast(removed.length + "칸 지웠어요", "되돌리기", function () {
        var now = new Date().toISOString();
        removed.forEach(function (x) { state.rooms[x.room][x.slot] = x.name; });
        render();
        sb.from("reservations").upsert(removed.map(function (x) { return { day: day, room: x.room, slot: x.slot, name: x.name, updated_at: now }; }))
          .then(function (r2) { if (r2.error) { toast("되돌리지 못했어요."); load(); } });
      });
    }, function () {
      removed.forEach(function (x) { state.rooms[x.room][x.slot] = x.name; });
      render(); toast("지우지 못했어요. 인터넷 연결을 확인해 주세요.");
    });
  }

  // ---------- quick inline edit (admin: tap a cell and type) ----------
  var blurTimer = null, blurValue = "";

  var toastTimer = null;
  function toast(msg, actionLabel, action) {
    var t = document.getElementById("toast");
    if (!t) { t = el("div", "toast"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = ""; t.appendChild(el("span", null, msg));
    t.classList.toggle("has-action", !!action);
    if (action) {
      var b = el("button", "toast-btn", actionLabel); b.type = "button";
      b.onclick = function () { t.hidden = true; action(); };
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, action ? 6000 : 2200);
  }
  // 영문 상태로 친 이름을 한글로 (dbals -> 유민)
  function koFix(raw) {
    var fixed = window.fixKorean ? window.fixKorean(raw) : raw;
    return { text: fixed, changed: fixed !== raw, raw: raw };
  }
  function durText(n) { var m = n * 30; return (m >= 60 ? Math.floor(m / 60) + "시간" : "") + (m % 60 ? (m >= 60 ? " " : "") + "30분" : ""); }
  function previewCell(r, i, hour) {
    var name = state.inlineValue || "";
    var d = el("div", "cell " + r.c + " on cont preview" + (hour ? " hour" : "") + (name.indexOf("수업") !== -1 ? " lesson" : ""));
    d.appendChild(el("span", "nm", name));
    return d;
  }
  // 다음 칸으로 늘릴 수 없으면 이유를, 늘릴 수 있으면 ""
  function extendBlock(cur, name) {
    var next = cur.slot + (cur.span || 0) + 1;
    var day = kst().date, rooms = state.day === day ? state.rooms : emptyRooms();
    var other = rooms[cur.room][next];
    if (next >= SLOTS) return "10:00가 마지막 시간이에요";
    if (other && other !== name) return "다음 칸에 '" + other + "' 예약이 있어요";
    return "";
  }
  function extendInline() {
    var cur = state.inline; if (!cur) return;
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
    var next = cur.slot + (cur.span || 0) + 1;
    var name = (state.inlineValue || "").trim();
    var day = kst().date, rooms = state.day === day ? state.rooms : emptyRooms();
    var other = rooms[cur.room][next];
    if (next >= SLOTS) toast("10:00가 마지막 시간이에요");
    else if (other && other !== name) toast("다음 칸에 '" + other + "' 예약이 있어서 더 늘릴 수 없어요");
    else {
      cur.span = (cur.span || 0) + 1;
      var a = label(cur.slot).split("~")[0], b = label(cur.slot + cur.span).split("~")[1];
      toast(a + "~" + b + " (" + durText(cur.span + 1) + ")");
    }
    render(); focusInline(true);
  }
  function inlineCell(r, i, v, hour) {
    var d = el("div", "cell " + r.c + " inline" + (hour ? " hour" : ""));
    var inp = el("input");
    if (state.inlineValue == null) state.inlineValue = v;
    inp.id = "inline-input"; inp.maxLength = 20; inp.value = state.inlineValue; inp.disabled = state.inlineBusy;
    inp.oninput = function () {
      state.inlineValue = inp.value;
      var nm = (inp.value || "");
      document.querySelectorAll(".cell.preview").forEach(function (pc) {
        pc.firstChild.textContent = nm;
        pc.classList.toggle("lesson", nm.indexOf("수업") !== -1);
      });
    };
    inp.setAttribute("aria-label", r.n + " " + label(i) + " 예약자 이름");
    inp.setAttribute("enterkeyhint", "done"); inp.autocomplete = "off";
    var done = false;
    function go(next) { done = true; commitInline(inp.value, next); }
    inp.onkeydown = function (e) {
      if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중 키 무시
      var cur = state.inline;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { // Ctrl(⌘)+Enter: 1시간으로 저장
        e.preventDefault();
        if (!(cur.span > 0)) {
          var why = extendBlock(cur, (inp.value || "").trim());
          if (why) { toast(why + " (1시간 저장 불가)"); return; }
          cur.span = 1;
        }
        go(null);
      }
      else if (e.key === "Enter") { e.preventDefault(); go(null); }
      else if (e.key === "Escape") { e.preventDefault(); done = true; closeInline(); }
      else if (e.key === "ArrowDown" && cur.slot + (cur.span || 0) < SLOTS - 1) { e.preventDefault(); go({ room: cur.room, slot: cur.slot + (cur.span || 0) + 1 }); }
      else if (e.key === "ArrowUp" && cur.slot > 0) { e.preventDefault(); go({ room: cur.room, slot: cur.slot - 1 }); }
      else if (e.key === "Tab") { e.preventDefault(); go({ room: cur.room === "band" ? "drum" : "band", slot: cur.slot }); }
    };
    // 다른 칸을 누르면 blur 다음에 click 이 오므로 잠깐 기다렸다가 저장
    inp.onblur = function () {
      if (done || state.inlineBusy) return;
      done = true; blurValue = inp.value;
      blurTimer = setTimeout(function () { blurTimer = null; commitInline(blurValue, null); }, 250);
    };
    d.appendChild(inp);
    var ok = el("button", "ok-btn", "확인"); ok.type = "button"; ok.tabIndex = -1;
    ok.addEventListener("mousedown", function (e) { e.preventDefault(); }); // 입력창 포커스 유지
    ok.onclick = function (e) {
      e.preventDefault();
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      done = true;
      commitInline(state.inlineValue != null ? state.inlineValue : inp.value, null);
    };
    var acts = el("div", "acts" + (i >= SLOTS - 2 ? " up" : ""));
    acts.appendChild(ok);
    var eb = el("button", "ext-btn", "+30분"); eb.type = "button"; eb.tabIndex = -1;
    eb.setAttribute("aria-label", "30분 더 예약");
    eb.addEventListener("mousedown", function (e) { e.preventDefault(); }); // 입력창 포커스 유지
    eb.onclick = function (e) { e.preventDefault(); extendInline(); };
    acts.appendChild(eb);
    d.appendChild(acts);
    return d;
  }
  function focusInline(keepText) {
    var inp = document.getElementById("inline-input");
    if (!inp) return;
    inp.focus();
    if (keepText) { var n = inp.value.length; try { inp.setSelectionRange(n, n); } catch (e) {} }
    else inp.select();
  }
  function selectCell(target) {
    if (state.inlineBusy) { state.queued = target; return; }
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; commitInline(blurValue, target); return; }
    state.inline = { room: target.room, slot: target.slot, span: 0 }; state.flash = "";
    state.inlineValue = null; state.inlineMsg = "";
    render(); focusInline(); // 같은 탭 안에서 바로 포커스해야 휴대폰 키보드가 열림
  }
  function closeInline() {
    var cur = state.inline; state.inline = null; state.inlineValue = null; state.inlineMsg = ""; render();
    if (cur) focusCell(cur);
  }
  function focusCell(cur) {
    var cells = document.querySelectorAll(".cell." + (cur.room === "band" ? "b" : "d"));
    if (cells[cur.slot]) cells[cur.slot].focus();
  }
  function afterCommit(cur, next) {
    var q = state.queued; state.queued = null;
    next = next || q;
    state.inline = next ? { room: next.room, slot: next.slot, span: 0 } : null;
    state.inlineValue = null; state.inlineMsg = "";
    render();
    if (next) focusInline(); else focusCell(cur);
  }
  function writeSlots(room, slots, name) {
    var day = kst().date;
    slots.forEach(function (k) { state.rooms[room][k] = name; });
    render();
    var now = new Date().toISOString();
    sb.from("reservations").upsert(slots.map(function (k) { return { day: day, room: room, slot: k, name: name, updated_at: now }; }))
      .then(function (res) { if (res.error) { toast("되돌리지 못했어요. 칸을 눌러 직접 고쳐 주세요."); load(); } });
  }
  function commitInline(value, next) {
    var cur = state.inline; if (!cur) return;
    var fx = koFix((value || "").trim());
    var name = fx.text, day = kst().date;
    if (state.day !== day) { state.rooms = emptyRooms(); state.day = day; }
    var slots = [];
    for (var k = cur.slot; k <= cur.slot + (cur.span || 0); k++) slots.push(k);
    var prev = {};
    slots.forEach(function (k) { prev[k] = state.rooms[cur.room][k]; });
    var changed = slots.some(function (k) { return (prev[k] || "") !== name; });
    if (!changed) { afterCommit(cur, next); return; }
    state.inlineBusy = true;
    slots.forEach(function (k) { if (name) state.rooms[cur.room][k] = name; else delete state.rooms[cur.room][k]; });
    state.inline = null; render(); // 저장 중에도 입력한 값이 보이게
    state.inline = cur;
    var now = new Date().toISOString();
    var q = name
      ? sb.from("reservations").upsert(slots.map(function (k) { return { day: day, room: cur.room, slot: k, name: name, updated_at: now }; }))
      : sb.from("reservations").delete().eq("day", day).eq("room", cur.room).in("slot", slots);
    function fail(msg) {
      state.inlineBusy = false; state.inline = null; state.queued = null; state.inlineValue = null;
      slots.forEach(function (k) { if (prev[k]) state.rooms[cur.room][k] = prev[k]; else delete state.rooms[cur.room][k]; });
      state.flash = msg; render();
    }
    q.then(function (res) {
      if (res.error) {
        fail(/row-level security|permission/i.test(res.error.message)
          ? "저장 권한이 없어요. 관리자 이메일로 로그인했는지 확인해 주세요."
          : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      state.inlineBusy = false; state.inlineValue = null;
      afterCommit(cur, next);
      if (fx.changed) toast(fx.raw + " → " + name + " 한글로 바꿨어요", "되돌리기", function () { writeSlots(cur.room, slots, fx.raw); });
    }, function () { fail("저장하지 못했어요. 인터넷 연결을 확인해 주세요."); });
  }

  function renderHeaderLive() {
    var lv = document.getElementById("livechip");
    if (!lv) return;
    lv.className = "chip live" + (state.live ? "" : " off");
    lv.textContent = state.live ? "실시간" : "자동 새로고침";
  }

  function adminArea() {
    var wrap = el("div");
    if (state.session) {
      var row = el("div", "tools");
      var email = state.session.user && state.session.user.email;
      row.appendChild(el("span", "note", email + (state.isAdmin ? " (관리자)" : " · 관리자 권한 없음")));
      if (state.isAdmin) { var al = el("a", "btn link", "관리자 페이지"); al.href = "admin.html"; row.appendChild(al); }
      row.appendChild(btn("btn link", "로그아웃", function () { sb.auth.signOut(); }));
      wrap.appendChild(row);
      return wrap;
    }
    if (!state.showLogin) {
      wrap.appendChild(btn("btn link", "관리자 로그인", function () { state.showLogin = true; render(); }));
      return wrap;
    }
    var f = el("form", "login");
    f.appendChild(el("p", null, "관리자 이메일을 입력하면 로그인 링크를 보내 드려요."));
    var inp = el("input"); inp.type = "email"; inp.id = "admin-email"; inp.required = true;
    inp.placeholder = "admin@example.com"; inp.autocomplete = "email"; inp.setAttribute("aria-label", "관리자 이메일");
    f.appendChild(inp);
    var sbtn = el("button", "btn primary", "링크 받기"); sbtn.type = "submit"; f.appendChild(sbtn);
    if (state.loginMsg) f.appendChild(el("p", null, state.loginMsg));
    f.onsubmit = function (e) {
      e.preventDefault();
      sbtn.disabled = true;
      sb.auth.signInWithOtp({
        email: inp.value.trim(),
        options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true }
      }).then(function (res) {
        state.loginMsg = res.error ? "링크를 보내지 못했어요: " + res.error.message
          : "메일함을 확인해 주세요. 링크를 누르면 이 페이지로 돌아와 로그인됩니다.";
        render();
      });
    };
    wrap.appendChild(f);
    return wrap;
  }

  function renderBar() {
    var old = document.getElementById("bar");
    if (old) old.remove();
    if (!state.editing) return;
    var bar = el("div", "bar"); bar.id = "bar";
    var b = el("div", "bar-in");
    var n = Object.keys(state.sel).length;
    b.appendChild(el("div", "hint", n ? n + "칸 선택됨 · 이름을 넣고 적용하세요" : "칸을 눌러 선택하세요 (여러 칸 선택 가능)"));
    var inp = el("input"); inp.id = "who"; inp.placeholder = "이름 입력"; inp.maxLength = 20;
    inp.setAttribute("aria-label", "예약자 이름"); inp.value = state.who;
    inp.oninput = function () { state.who = inp.value; };
    inp.onkeydown = function (e) { if (e.key === "Enter") apply(inp.value); };
    b.appendChild(inp);
    var ab = btn("btn", "적용", function () { apply(inp.value); }); ab.disabled = !n; b.appendChild(ab);
    var cb = btn("btn", "비우기", function () { apply(""); }); cb.disabled = !n; b.appendChild(cb);
    b.appendChild(el("span", "spacer"));
    var xb = btn("btn", "취소", function () { state.editing = false; state.sel = {}; state.status = ""; render(); });
    xb.disabled = state.busy; b.appendChild(xb);
    var svb = btn("btn primary", state.busy ? "저장 중…" : "저장", save); svb.disabled = state.busy; b.appendChild(svb);
    if (state.status) b.appendChild(el("div", "hint status", state.status));
    bar.appendChild(b);
    document.body.appendChild(bar);
  }

  // ---------- editing ----------
  function startEdit() {
    state.inline = null;
    state.draft = { band: Object.assign({}, state.rooms.band), drum: Object.assign({}, state.rooms.drum) };
    state.sel = {}; state.editing = true; state.status = "";
    render();
  }
  function apply(name) {
    var fx = koFix((name || "").trim());
    name = fx.text;
    var keys = Object.keys(state.sel);
    keys.forEach(function (key) {
      var p = key.split(":");
      if (name) state.draft[p[0]][p[1]] = name; else delete state.draft[p[0]][p[1]];
    });
    if (fx.changed) toast(fx.raw + " → " + name + " 한글로 바꿨어요", "되돌리기", function () {
      keys.forEach(function (key) { var p = key.split(":"); state.draft[p[0]][p[1]] = fx.raw; });
      render();
    });
    state.sel = {};
    render();
    var w = document.getElementById("who");
    if (w && name) w.focus();
  }
  function save() {
    if (state.busy) return;
    var day = kst().date;
    var base = state.day === day ? state.rooms : emptyRooms();
    var upserts = [], deletes = [];
    ROOMS.forEach(function (r) {
      for (var i = 0; i < SLOTS; i++) {
        var a = base[r.k][i] || "", b = state.draft[r.k][i] || "";
        if (b && a !== b) upserts.push({ day: day, room: r.k, slot: i, name: b, updated_at: new Date().toISOString() });
        if (!b && a) deletes.push({ room: r.k, slot: i });
      }
    });
    if (!upserts.length && !deletes.length) { state.editing = false; render(); return; }
    state.busy = true; state.status = ""; renderBar();
    var jobs = [];
    if (upserts.length) jobs.push(sb.from("reservations").upsert(upserts));
    deletes.forEach(function (d) {
      jobs.push(sb.from("reservations").delete().match({ day: day, room: d.room, slot: d.slot }));
    });
    Promise.all(jobs).then(function (results) {
      state.busy = false;
      var err = results.filter(function (r) { return r.error; })[0];
      if (err) {
        state.status = /row-level security|permission/i.test(err.error.message)
          ? "저장 권한이 없어요. 관리자 이메일로 로그인했는지 확인해 주세요."
          : "저장하지 못했어요. 잠시 후 다시 눌러 주세요.";
        renderBar();
        return;
      }
      state.editing = false; state.sel = {};
      load().then(render);
    }, function () {
      state.busy = false; state.status = "저장하지 못했어요. 인터넷 연결을 확인해 주세요."; renderBar();
    });
  }

  // ---------- timers ----------
  function tick() {
    var k = kst(), sec = new Date().getSeconds();
    var ms = ((30 - (k.min % 30)) * 60 - sec) * 1000 + 500;
    setTimeout(function () { if (!state.editing && !state.inline) render(); tick(); }, Math.max(ms, 5000));
  }

  // ---------- boot ----------
  render();
  tick();
  if (sb) {
    sb.auth.getSession().then(function (res) {
      state.session = res.data && res.data.session;
      return checkAdmin();
    }).then(function () { render(); });
    sb.auth.onAuthStateChange(function (_evt, session) {
      state.session = session;
      if (!session) { state.isAdmin = false; state.editing = false; }
      checkAdmin().then(render);
    });
    load();
    subscribe();
    setInterval(function () { if (!state.editing && document.visibilityState === "visible") load(); }, 60000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && !state.editing) load(); });
  }
})();
