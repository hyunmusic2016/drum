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
    inline: null, inlineBusy: false, flash: ""
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
  function load() {
    if (!sb) return Promise.resolve();
    var day = kst().date;
    return sb.from("reservations").select("room,slot,name").eq("day", day).then(function (res) {
      if (res.error) { state.loadError = "예약을 불러오지 못했어요. 잠시 후 새로고침해 주세요."; render(); return; }
      var rooms = emptyRooms();
      (res.data || []).forEach(function (r) { if (rooms[r.room]) rooms[r.room][r.slot] = r.name; });
      state.day = day; state.rooms = rooms; state.loaded = true; state.loadError = "";
      if (!state.editing && !state.inline) render();
    });
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
    var wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(k.y, k.m - 1, k.d).getDay()];
    dt.appendChild(el("b", null, k.m + "월 " + k.d + "일 (" + wd + ")"));
    dt.appendChild(el("span", "chip", "매일 자정 초기화"));
    var lv = el("span", "chip live" + (state.live ? "" : " off"), state.live ? "실시간" : "자동 새로고침");
    lv.id = "livechip";
    if (sb) dt.appendChild(lv);
    l.appendChild(dt);
    hd.appendChild(l);

    var tools = el("div", "tools");
    if (state.isAdmin && !state.editing) {
      tools.appendChild(el("span", "admin-tag", "관리자"));
      tools.appendChild(btn("btn primary", "예약 편집", startEdit));
    }
    hd.appendChild(tools);
    root.appendChild(hd);

    if (state.flash) {
      root.appendChild(el("p", "notice warn", state.flash));
    }
    if (!sb) {
      root.appendChild(el("p", "notice warn", "아직 Supabase가 연결되지 않았어요. config.js에 프로젝트 주소와 anon key를 넣어 주세요. (README 참고)"));
    } else if (state.loadError) {
      root.appendChild(el("p", "notice warn", state.loadError));
    } else if (state.loaded && !state.editing &&
      !Object.keys(rooms.band).length && !Object.keys(rooms.drum).length) {
      root.appendChild(el("p", "notice", "오늘은 아직 예약이 없어요. 모든 시간이 비어 있습니다."));
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

    root.appendChild(el("p", "note", state.isAdmin
      ? "칸을 두 번 누르면 바로 입력할 수 있어요. Enter로 저장, Esc로 취소, 비우고 Enter를 누르면 지워집니다. 여러 칸을 한 번에 바꾸려면 예약 편집을 쓰세요. 날짜가 바뀌면 표는 자동으로 비워집니다."
      : "이 페이지는 보기 전용입니다. 예약은 관리자에게 문의해 주세요. 날짜가 바뀌면 표는 자동으로 비워집니다."));

    if (sb) root.appendChild(adminArea());
    renderBar();
  }

  function cell(r, i, rooms, hour) {
    var v = rooms[r.k][i] || "", prev = i > 0 ? (rooms[r.k][i - 1] || "") : "";
    if (state.inline && state.inline.room === r.k && state.inline.slot === i) return inlineCell(r, i, v, hour);
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
      c.title = "두 번 눌러 입력";
      var last = 0;
      c.addEventListener("pointerup", function (e) {
        if (e.button > 0) return;
        var now = Date.now();
        if (now - last < 400) { last = 0; openInline(r.k, i); } else last = now;
      });
      c.onkeydown = function (e) { if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); openInline(r.k, i); } };
    } else {
      c.tabIndex = -1;
    }
    return c;
  }

  // ---------- quick inline edit (admin, double tap) ----------
  function inlineCell(r, i, v, hour) {
    var d = el("div", "cell " + r.c + " inline" + (hour ? " hour" : ""));
    var inp = el("input");
    inp.id = "inline-input"; inp.maxLength = 20; inp.value = v; inp.disabled = state.inlineBusy;
    inp.setAttribute("aria-label", r.n + " " + label(i) + " 예약자 이름");
    inp.setAttribute("enterkeyhint", "done"); inp.autocomplete = "off";
    var done = false;
    inp.onkeydown = function (e) {
      if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter 무시
      if (e.key === "Enter") { e.preventDefault(); done = true; commitInline(inp.value); }
      else if (e.key === "Escape") { e.preventDefault(); done = true; closeInline(); }
    };
    inp.onblur = function () { if (!done && !state.inlineBusy) { done = true; commitInline(inp.value); } };
    d.appendChild(inp);
    setTimeout(function () { inp.focus(); inp.select(); }, 0);
    return d;
  }
  function openInline(room, slot) {
    if (state.inlineBusy) return;
    state.inline = { room: room, slot: slot }; state.flash = "";
    render();
  }
  function closeInline() {
    var cur = state.inline; state.inline = null; render();
    if (cur) focusCell(cur);
  }
  function focusCell(cur) {
    var cells = document.querySelectorAll(".cell." + (cur.room === "band" ? "b" : "d"));
    if (cells[cur.slot]) cells[cur.slot].focus();
  }
  function commitInline(value) {
    var cur = state.inline; if (!cur) return;
    var name = (value || "").trim(), day = kst().date;
    var before = state.day === day ? (state.rooms[cur.room][cur.slot] || "") : "";
    if (name === before) { closeInline(); return; }
    state.inlineBusy = true;
    var q = name
      ? sb.from("reservations").upsert([{ day: day, room: cur.room, slot: cur.slot, name: name, updated_at: new Date().toISOString() }])
      : sb.from("reservations").delete().match({ day: day, room: cur.room, slot: cur.slot });
    q.then(function (res) {
      state.inlineBusy = false; state.inline = null;
      if (res.error) {
        state.flash = /row-level security|permission/i.test(res.error.message)
          ? "저장 권한이 없어요. 관리자 이메일로 로그인했는지 확인해 주세요."
          : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
        render(); return;
      }
      if (state.day !== day) { state.rooms = emptyRooms(); state.day = day; }
      if (name) state.rooms[cur.room][cur.slot] = name; else delete state.rooms[cur.room][cur.slot];
      render(); focusCell(cur);
    }, function () {
      state.inlineBusy = false; state.inline = null;
      state.flash = "저장하지 못했어요. 인터넷 연결을 확인해 주세요."; render();
    });
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
    name = (name || "").trim();
    Object.keys(state.sel).forEach(function (key) {
      var p = key.split(":");
      if (name) state.draft[p[0]][p[1]] = name; else delete state.draft[p[0]][p[1]];
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
