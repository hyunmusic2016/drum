(function () {
  "use strict";

  var SLOTS = 18;            // 1:00 ~ 10:00 (오후), 30분 단위
  var START = 13 * 60;       // 13:00
  var ROOMS = [
    { k: "band", n: "합주실", c: "b" },
    { k: "drum", n: "드럼연습실", c: "d" }
  ];

  var KB = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches; // 키보드·마우스 기기
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
  var rendering = false; // 다시 그리는 중에 사라지는 입력칸의 blur 는 무시
  function render() {
    rendering = true;
    try { renderInner(); } finally { rendering = false; }
    // 아래 버전 표시를 표 오른쪽 끝에 맞춤
    var shw = document.querySelector(".wrap.home .sheet");
    if (shw) document.documentElement.style.setProperty("--home-w", shw.offsetWidth + "px");
  }
  function renderInner() {
    var k = kst();
    if (state.loaded && state.day !== k.date && !state.editing) { state.rooms = emptyRooms(); state.day = k.date; load(); }
    var rooms = state.editing ? state.draft : state.rooms;
    var root = document.getElementById("root");
    root.textContent = "";
    root.classList.toggle("editing", state.editing);
    document.body.classList.toggle("has-bar", state.editing);

    var hd = el("header"), l = el("div");
    l.appendChild(el("div", "eyebrow", "PRACTICE ROOM BOOKING"));
    var tl = el("div", "titleline");
    tl.appendChild(el("h1", null, "합주실 · 드럼연습실 예약"));
    var ck = el("span", "clock", clockText()); ck.id = "clock"; tl.appendChild(ck);
    l.appendChild(tl);
    var lv = el("span", "chip live" + (state.live ? "" : " off"), state.live ? "실시간" : "자동 새로고침");
    lv.id = "livechip";

    hd.appendChild(l);

    var tools = el("div", "tools");
    if (sb) tools.appendChild(lv); // 표 오른쪽 끝에 맞춰
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
    state.range = { r0: Math.min(ra, rb), r1: Math.max(ra, rb), s0: Math.min(a.slot, b.slot), s1: Math.max(a.slot, b.slot), anchor: a, head: b };
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
  // 화살표 한 칸 이동 (방 2개 x 시간 18칸 안에서)
  function stepCell(c, key) {
    var ri = roomIdx(c.room), sl = c.slot;
    if (key === "ArrowUp") sl--; else if (key === "ArrowDown") sl++;
    else if (key === "ArrowLeft") ri--; else if (key === "ArrowRight") ri++;
    if (ri < 0 || ri > 1 || sl < 0 || sl >= SLOTS) return null;
    return { room: ROOMS[ri].k, slot: sl };
  }
  function isArrow(k) { return k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight"; }
  function nowCell() {
    var m = kst().min, sl = Math.floor((m - START) / 30);
    return { room: "band", slot: Math.max(0, Math.min(SLOTS - 1, sl)) };
  }
  document.addEventListener("keydown", function (e) {
    if (!state.isAdmin || state.inline || state.editing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.id === "inline-input") return; // 입력칸에서 처리한 키
    var a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
    var fc0 = a && a.classList && a.classList.contains("quick") ? { room: a.dataset.room, slot: +a.dataset.slot } : null;
    // 글자 키: 선택된 칸에 바로 타이핑 (Enter 필요 없음). 기본 동작을 막지 않아 그 글자가 새 입력칸으로 들어감
    var printable = (e.key && e.key.length === 1) || e.key === "Process" || e.keyCode === 229;
    if (printable && (state.range || fc0 || state.lastCell)) {
      var tgt = state.range ? (state.range.head || state.range.anchor) : (fc0 || state.lastCell);
      if (state.range) clearRange(true);
      typeInto(tgt);
      return;
    }
    if (state.range) { // Shift+화살표로 고른 범위
      var g = state.range;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteRange(); }
      else if (e.key === "Escape") { e.preventDefault(); var h0 = g.head; clearRange(); if (h0) selectCell(h0); }
      else if (isArrow(e.key) && e.shiftKey) { e.preventDefault(); var nh = stepCell(g.head || g.anchor, e.key); if (nh) setRange(g.anchor, nh); }
      else if (isArrow(e.key) || e.key === "Enter") {
        e.preventDefault(); var base = g.head || g.anchor; clearRange();
        selectCell(e.key === "Enter" ? base : (stepCell(base, e.key) || base));
      }
      return;
    }
    // 아무 칸도 열려 있지 않을 때: 화살표·Enter·F2 로 키보드 조작 시작
    if (isArrow(e.key) && e.shiftKey && (fc0 || state.lastCell)) { // 닫힌 칸에서 Shift+화살표: 범위 선택
      e.preventDefault(); var an = fc0 || state.lastCell, nx = stepCell(an, e.key);
      if (nx) setRange(an, nx);
      return;
    }
    if (isArrow(e.key) || e.key === "Enter" || e.key === "F2") {
      var fc = a && a.classList && a.classList.contains("quick") ? { room: a.dataset.room, slot: +a.dataset.slot } : null;
      var start = fc || state.lastCell || nowCell();
      if (fc && isArrow(e.key)) start = stepCell(fc, e.key) || fc;
      e.preventDefault();
      selectCell(start);
    }
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
    var back = { room: ROOMS[g.r0].k, slot: g.s0 };
    state.range = null;
    if (!removed.length) { paintRange(); toast("지울 예약이 없어요"); if (KB) selectCell(back); return; }
    removed.forEach(function (x) { delete state.rooms[x.room][x.slot]; });
    render();
    if (KB) selectCell(back);
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
      record(removed.map(function (x) { return { room: x.room, slot: x.slot, before: x.name, after: "" }; }));
      toast(removed.length + "칸 지웠어요", "되돌리기", undo);
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
    // 엑셀처럼: select = 칸만 선택(커서 안 보임, 치면 내용 교체) / type = 치는 중 / edit = 커서 깜빡이며 고치기
    var mode = state.inlineMode || "select";
    var d = el("div", "cell " + r.c + " inline" + (hour ? " hour" : "") + (KB && mode === "select" ? " selmode" : "")
      + (v ? " on" : "") + (v.indexOf("수업") !== -1 ? " lesson" : ""));
    var inp = el("input");
    function setMode(m) { mode = state.inlineMode = m; d.classList.toggle("selmode", KB && m === "select"); }
    // 선택된 칸을 한 번 더 클릭하면 커서가 나타나 그 자리부터 고치기
    inp.addEventListener("mousedown", function () { if (mode === "select") setMode("edit"); });
    if (state.inlineValue == null) { state.inlineValue = v; state.inlineOrig = v; }
    inp.id = "inline-input"; inp.maxLength = 20; inp.value = state.inlineValue; inp.disabled = state.inlineBusy;
    inp.oninput = function (e) {
      if (mode === "select") setMode("type");
      // 스페이스 두 번 -> '수업' (휴대폰이 바꿔 넣는 '. ' 도 같은 것으로 봄)
      if (!(e && e.isComposing) && /(\s\s|[.。]\s)$/.test(inp.value)) {
        var base = inp.value.replace(/(\s\s|[.。]\s)$/, "").trim();
        inp.value = base && base.indexOf("수업") === -1 ? base + " 수업" : (base || "수업");
        try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (er) {}
      }
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
    // 키 -> 실행할 동작 (실행 시점의 입력값을 읽음)
    function actionFor(e) {
      var cur = state.inline; if (!cur) return null;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return function () { // Ctrl(⌘)+Enter: 1시간으로 저장
        if (done || state.inline !== cur) return;
        if (!(cur.span > 0)) {
          var why = extendBlock(cur, (inp.value || "").trim());
          if (why) { toast(why + " (1시간 저장 불가)"); return; }
          cur.span = 1;
        }
        go(below(cur));
      };
      if (e.key === "Enter") return function () { if (!done && state.inline === cur) go(below(cur)); };
      if (e.key === "ArrowDown" && cur.slot + (cur.span || 0) < SLOTS - 1)
        return function () { if (!done && state.inline === cur) go({ room: cur.room, slot: cur.slot + (cur.span || 0) + 1 }); };
      if (e.key === "ArrowUp" && cur.slot > 0)
        return function () { if (!done && state.inline === cur) go({ room: cur.room, slot: cur.slot - 1 }); };
      // ←→ : 칸 선택·타이핑 중엔 옆 방으로 이동, 커서로 고치는 중(edit)엔 커서만 이동
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && mode !== "edit") {
        var target = e.key === "ArrowLeft" ? (cur.room === "drum" ? "band" : null) : (cur.room === "band" ? "drum" : null);
        if (target) return function () { if (!done && state.inline === cur) go({ room: target, slot: cur.slot }); };
        return function () {};
      }
      return null;
    }
    var pending = null;
    // 한글 조합 중에 누른 Enter·⌘+Enter·↑↓ 는 조합이 끝나자마자 실행 (두 번 누를 필요 없음)
    inp.addEventListener("compositionend", function () {
      if (!pending) return;
      var a = pending; pending = null;
      setTimeout(a, 0);
    });
    inp.onkeydown = function (e) {
      var cur = state.inline;
      var untouched = inp.value === (state.inlineOrig || "") && !(cur && cur.span > 0);
      if (e.key === "Escape") {
        e.preventDefault(); pending = null;
        if (!untouched || mode !== "select") { // 고치던 내용만 되돌리고 칸 선택 상태로
          cur.span = 0; state.inlineValue = null; state.inlineMode = "select"; render(); focusInline(); return;
        }
        done = true; closeInline(); return;
      }
      if (e.key === "F2" && mode === "select") { // F2: 커서 켜고 고치기
        e.preventDefault(); setMode("edit"); var n = inp.value.length; try { inp.setSelectionRange(n, n); } catch (er) {} return;
      }
      if (!e.isComposing && untouched && cur && mode === "select") {
        var allSel = inp.selectionStart === 0 && inp.selectionEnd === inp.value.length;
        if ((e.key === "Delete" || e.key === "Backspace") && allSel && inp.value) { // 칸 비우기
          e.preventDefault(); done = true; commitInline("", { room: cur.room, slot: cur.slot }); return;
        }
        if (isArrow(e.key) && e.shiftKey) { // Shift+화살표: 여러 칸 선택 시작
          var nb = stepCell(cur, e.key);
          if (nb) { e.preventDefault(); done = true; var c0 = { room: cur.room, slot: cur.slot }; closeInline(); setRange(c0, nb); }
          return;
        }
      }
      if (e.key === "Tab") { e.preventDefault(); return; } // Tab 은 아무 동작 안 함
      var a = actionFor(e);
      if (!a) return;
      if (e.isComposing) { pending = a; return; }        // 조합 끝(compositionend) 뒤에 실행
      e.preventDefault();
      if (e.keyCode === 229) { setTimeout(a, 0); return; } // 사파리: 조합이 막 끝난 직후의 키
      a();
    };
    // 다른 칸을 누르면 blur 다음에 click 이 오므로 잠깐 기다렸다가 저장
    inp.onblur = function () {
      if (rendering || done || state.inlineBusy) return;
      done = true; blurValue = inp.value;
      blurTimer = setTimeout(function () { blurTimer = null; commitInline(blurValue, null); }, 250);
    };
    d.appendChild(inp);
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent), mod = mac ? "⌘" : "Ctrl";
    var ok = el("button", "ok-btn", "확인"); ok.type = "button"; ok.tabIndex = -1;
    ok.dataset.tip = "Enter · 30분 저장";
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
    eb.dataset.tip = mod + "+Enter · 1시간 바로 저장";
    eb.setAttribute("aria-label", "30분 더 예약");
    eb.addEventListener("mousedown", function (e) { e.preventDefault(); }); // 입력창 포커스 유지
    eb.onclick = function (e) { e.preventDefault(); extendInline(); };
    acts.appendChild(eb);
    d.appendChild(acts);
    // 키보드 단축키 안내 (입력 중에만, 키보드가 있는 기기에서만 보임)
    var keys = el("div", "keyhint");
    [["Enter", "30분"], [mod + "+Enter", "1시간"], ["Esc", "취소"], ["↑↓←→", "이동"]].forEach(function (p) {
      var it = el("span", "kh"); it.appendChild(el("kbd", null, p[0])); it.appendChild(document.createTextNode(" " + p[1])); keys.appendChild(it);
    });
    d.appendChild(keys);
    // 엑셀 채우기 핸들: 선택된 칸 오른쪽 아래 동그라미를 위아래로 끌면 같은 내용으로 채움
    if (KB && mode === "select" && v) {
      var fh = el("div", "fill-handle");
      fh.addEventListener("mousedown", function (e) { e.preventDefault(); }); // 입력칸 포커스 유지
      fh.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        fill = { room: r.k, from: i, to: i, name: v };
        document.body.classList.add("filling");
      });
      d.appendChild(fh);
    }
    return d;
  }

  // ---------- 채우기 핸들 드래그 ----------
  var fill = null;
  function slotAtY(y) {
    var times = document.querySelectorAll(".sheet > .time");
    for (var k = 0; k < times.length; k++) {
      var rc = times[k].getBoundingClientRect();
      if (y < rc.bottom) return k;
    }
    return times.length - 1;
  }
  function paintFill() {
    document.querySelectorAll(".cell.fillsel").forEach(function (c) { c.classList.remove("fillsel"); });
    if (!fill || fill.to === fill.from) return;
    var lo = Math.min(fill.from, fill.to), hi = Math.max(fill.from, fill.to);
    var col = fill.room === "band" ? 1 : 2, kids = document.querySelector(".sheet").children;
    for (var k = lo; k <= hi; k++) {
      if (k === fill.from) continue;
      var c = kids[3 + k * 3 + col]; if (c) c.classList.add("fillsel");
    }
  }
  document.addEventListener("pointermove", function (e) {
    if (!fill) return;
    var t = slotAtY(e.clientY);
    if (t !== fill.to) { fill.to = t; paintFill(); }
  });
  document.addEventListener("pointerup", function () {
    if (!fill) return;
    var f = fill; fill = null;
    document.body.classList.remove("filling");
    paintFill();
    if (f.to === f.from) return;
    var lo = Math.min(f.from, f.to), hi = Math.max(f.from, f.to), day = kst().date;
    var rooms = state.day === day ? state.rooms : emptyRooms(), changes = [];
    for (var k = lo; k <= hi; k++) {
      if (k === f.from) continue;
      changes.push({ room: f.room, slot: k, before: rooms[f.room][k] || "", after: f.name });
    }
    record(changes);
    applyChanges(changes, false);
    focusInline();
    toast((hi - lo) + "칸에 복사했어요");
  });
  // 단축키 안내가 입력칸을 가리면 화면 위쪽으로
  function placeKeyhint() {
    var k = document.querySelector(".keyhint"), inp = document.getElementById("inline-input");
    if (!k || !inp) return;
    var r = inp.getBoundingClientRect();
    k.classList.toggle("top", r.bottom > window.innerHeight - 90);
  }
  window.addEventListener("scroll", placeKeyhint, { passive: true });
  window.addEventListener("resize", placeKeyhint);
  function focusInline(keepText) {
    var inp = document.getElementById("inline-input");
    if (!inp) return;
    placeKeyhint();
    inp.focus();
    if (keepText) { var n = inp.value.length; try { inp.setSelectionRange(n, n); } catch (e) {} }
    else inp.select();
  }
  function below(cur) {
    if (!KB) return null; // 휴대폰: Enter 는 저장 후 닫기
    var n = cur.slot + (cur.span || 0) + 1;
    return n < SLOTS ? { room: cur.room, slot: n } : null;
  }
  // 칸을 빈 입력칸으로 열고 포커스 (이어서 누른 글자가 바로 들어가게)
  function typeInto(target) {
    if (state.inlineBusy || blurTimer) { selectCell(target); return; }
    var day = kst().date, rooms = state.day === day ? state.rooms : emptyRooms();
    state.inline = { room: target.room, slot: target.slot, span: 0 }; state.flash = "";
    state.inlineOrig = rooms[target.room][target.slot] || ""; state.inlineValue = ""; state.inlineMode = "type";
    state.inlineMsg = ""; state.lastCell = { room: target.room, slot: target.slot };
    render();
    var inp = document.getElementById("inline-input");
    if (inp) { placeKeyhint(); inp.focus(); }
  }
  function selectCell(target) {
    if (state.inlineBusy) { state.queued = target; return; }
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; commitInline(blurValue, target); return; }
    state.inline = { room: target.room, slot: target.slot, span: 0 }; state.flash = "";
    state.inlineValue = null; state.inlineMsg = ""; state.lastCell = { room: target.room, slot: target.slot };
    state.inlineMode = "select";
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
    if (next) { state.lastCell = { room: next.room, slot: next.slot }; state.inlineMode = "select"; }
    render();
    if (next) focusInline(); else focusCell(cur);
  }
  // ---------- undo / redo (⌘/Ctrl+Z, ⌘/Ctrl+X) ----------
  // 한 번의 동작 = [{room, slot, before, after}] ("" = 빈 칸)
  var undoStack = [], redoStack = [];
  function record(changes) {
    changes = changes.filter(function (c) { return c.before !== c.after; });
    if (!changes.length) return;
    undoStack.push(changes); if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
  }
  function applyChanges(changes, useBefore) {
    var day = kst().date;
    if (state.day !== day) { state.rooms = emptyRooms(); state.day = day; }
    changes.forEach(function (c) {
      var v = useBefore ? c.before : c.after;
      if (v) state.rooms[c.room][c.slot] = v; else delete state.rooms[c.room][c.slot];
    });
    render();
    var now = new Date().toISOString(), ups = [], jobs = [];
    ROOMS.forEach(function (r) {
      var dels = [];
      changes.forEach(function (c) {
        if (c.room !== r.k) return;
        var v = useBefore ? c.before : c.after;
        if (v) ups.push({ day: day, room: c.room, slot: c.slot, name: v, updated_at: now }); else dels.push(c.slot);
      });
      if (dels.length) jobs.push(sb.from("reservations").delete().eq("day", day).eq("room", r.k).in("slot", dels));
    });
    if (ups.length) jobs.push(sb.from("reservations").upsert(ups));
    return Promise.all(jobs).then(function (res) {
      if (res.some(function (x) { return x.error; })) { toast("저장하지 못했어요. 새로고침해 주세요."); load(); return false; }
      return true;
    }, function () { toast("저장하지 못했어요. 인터넷 연결을 확인해 주세요."); load(); return false; });
  }
  function undo() {
    var ch = undoStack.pop(); if (!ch) { toast("되돌릴 작업이 없어요"); return; }
    redoStack.push(ch);
    applyChanges(ch, true); toast("되돌렸어요");
  }
  function redo() {
    var ch = redoStack.pop(); if (!ch) { toast("다시 할 작업이 없어요"); return; }
    undoStack.push(ch);
    applyChanges(ch, false); toast("다시 했어요");
  }
  document.addEventListener("keydown", function (e) {
    if (!state.isAdmin || state.editing || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    var a = document.activeElement;
    var isUndo = e.code === "KeyZ" && !e.shiftKey, isRedo = e.code === "KeyX" || e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey);
    if (!isUndo && !isRedo) return;
    var reopen = null;
    if (state.inline) {
      var inp = document.getElementById("inline-input");
      // 칸만 열어 두고 아무것도 안 고쳤을 때는 표 전체 되돌리기, 고치는 중이면 글자 되돌리기(브라우저 기본)
      if (!inp || inp.value !== (state.inlineOrig || "") || state.inline.span > 0) return;
      reopen = { room: state.inline.room, slot: state.inline.slot };
      inp.onblur = null; // 닫힐 때 저장하지 않게
      state.inline = null; state.inlineValue = null;
    } else if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
    e.preventDefault();
    if (isUndo) undo(); else redo();
    if (reopen) selectCell(reopen);
  });

  function writeSlots(room, slots, name) {
    var day = kst().date;
    record(slots.map(function (k) { return { room: room, slot: k, before: state.rooms[room][k] || "", after: name }; }));
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
      record(slots.map(function (k) { return { room: cur.room, slot: k, before: prev[k] || "", after: name }; }));
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
    return wrap; // 로그인은 관리자 페이지(admin.html)에서만
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

  // 지금 시간부터 차례로 보며 비어 있는 칸: 합주실 먼저, 차 있으면 드럼연습실, 둘 다 차 있으면 다음 시간대
  function idleTarget() {
    var start = nowCell().slot, day = kst().date, rooms = state.day === day ? state.rooms : emptyRooms();
    for (var sl = start; sl < SLOTS; sl++) {
      if (!rooms.band[sl]) return { room: "band", slot: sl };
      if (!rooms.drum[sl]) return { room: "drum", slot: sl };
    }
    return { room: "band", slot: start }; // 끝까지 다 차 있으면 지금 시간 합주실
  }
  // ---------- 자리 비움: 1분 동안 아무 조작이 없으면 지금 시간의 합주실 칸으로 ----------
  var IDLE_MS = 60 * 1000, lastActive = Date.now();
  ["keydown", "pointerdown", "input", "wheel"].forEach(function (ev) {
    document.addEventListener(ev, function () { lastActive = Date.now(); }, true);
  });
  setInterval(function () {
    if (!state.isAdmin || !KB || state.editing || state.inlineBusy || drag.on || fill) return;
    if (Date.now() - lastActive < IDLE_MS || document.visibilityState !== "visible") return;
    var t = idleTarget(), cur = state.inline;
    if (cur && cur.room === t.room && cur.slot === t.slot && (state.inlineMode || "select") === "select" && !state.range) return;
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
    var inp = document.getElementById("inline-input");
    if (inp) inp.onblur = null;      // 치다 만 내용은 저장하지 않고 버림
    clearRange(true);
    state.inline = null; state.inlineValue = null; state.queued = null;
    selectCell(t);
  }, 5000);

  // ---------- 현재 시각 (한국 시간, 1초마다) ----------
  function clockText() {
    var f = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    return f.format(new Date());
  }
  setInterval(function () { var c = document.getElementById("clock"); if (c) c.textContent = clockText(); }, 1000);

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
