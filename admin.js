(function () {
  "use strict";

  var ROOMS = [
    { k: "band", n: "합주실", c: "b" },
    { k: "drum", n: "드럼연습실", c: "d" }
  ];
  var HOURS = [13, 14, 15, 16, 17, 18, 19, 20, 21];   // 수업 시작 시각 (1시간 수업)
  var DAYS = [1, 2, 3, 4, 5, 6, 0];                    // 월 ~ 일
  var DAY_NAME = ["일", "월", "화", "수", "목", "금", "토"];
  var LABEL = "수업";

  var cfg = window.APP_CONFIG || {};
  var sb = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  var state = {
    session: null, isAdmin: false, checked: false,
    lessons: {},          // "weekday:room:hour" -> label
    loaded: false, day: kst().dow, busy: {}, loginMsg: ""
  };

  function kst() {
    var f = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
    });
    var p = {};
    f.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    var date = p.year + "-" + p.month + "-" + p.day;
    return { date: date, dow: new Date(+p.year, +p.month - 1, +p.day).getDay() };
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function key(d, r, h) { return d + ":" + r + ":" + h; }
  function hourLabel(h) { function f(x) { return (x % 12 || 12) + ":00"; } return f(h) + "~" + f(h + 1); }

  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) { t = el("div", "toast"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------- data ----------
  function checkAdmin() {
    if (!sb || !state.session) { state.isAdmin = false; state.checked = true; return Promise.resolve(); }
    var email = state.session.user && state.session.user.email;
    return sb.from("admins").select("email").eq("email", email).maybeSingle().then(function (res) {
      state.isAdmin = !!(res.data && !res.error); state.checked = true;
    });
  }
  function loadLessons() {
    return sb.from("lessons").select("weekday,room,hour,label").then(function (res) {
      if (res.error) { toast("수업 시간표를 불러오지 못했어요. lessons.sql을 실행했는지 확인해 주세요."); return; }
      var m = {};
      (res.data || []).forEach(function (l) { m[key(l.weekday, l.room, l.hour)] = l.label; });
      state.lessons = m; state.loaded = true;
      render();
    });
  }

  function toggle(d, r, h) {
    var k = key(d, r, h);
    if (state.busy[k]) return;
    var on = !state.lessons[k];
    state.busy[k] = true;
    if (on) state.lessons[k] = LABEL; else delete state.lessons[k];
    render();
    var q = on
      ? sb.from("lessons").upsert([{ weekday: d, room: r, hour: h, label: LABEL }])
      : sb.from("lessons").delete().match({ weekday: d, room: r, hour: h });
    q.then(function (res) {
      delete state.busy[k];
      if (res.error) {
        if (on) delete state.lessons[k]; else state.lessons[k] = LABEL;
        render();
        toast(/row-level security|permission/i.test(res.error.message) ? "저장 권한이 없어요." : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      render();
      if (d === kst().dow) syncToday(r, h, on);
    }, function () {
      delete state.busy[k];
      if (on) delete state.lessons[k]; else state.lessons[k] = LABEL;
      render(); toast("저장하지 못했어요. 인터넷 연결을 확인해 주세요.");
    });
  }

  // 오늘 요일을 바꾸면 오늘 예약표에도 바로 반영 (다른 예약이 있는 칸은 건드리지 않음)
  function syncToday(r, h, on) {
    var day = kst().date, slots = [(h - 13) * 2, (h - 13) * 2 + 1];
    if (on) {
      sb.from("reservations").upsert(slots.map(function (s) { return { day: day, room: r, slot: s, name: LABEL }; }),
        { onConflict: "day,room,slot", ignoreDuplicates: true }).then(function () {}, function () {});
    } else {
      sb.from("reservations").delete().eq("day", day).eq("room", r).eq("name", LABEL).in("slot", slots)
        .then(function () {}, function () {});
    }
  }

  // ---------- render ----------
  function render() {
    var root = document.getElementById("root");
    root.textContent = "";

    var hd = el("header"), l = el("div");
    l.appendChild(el("div", "eyebrow", "ADMIN"));
    l.appendChild(el("h1", null, "정기 수업"));
    hd.appendChild(l);
    var back = el("a", "btn", "예약표로"); back.href = "./";
    var tools = el("div", "tools"); tools.appendChild(back); hd.appendChild(tools);
    root.appendChild(hd);

    if (!sb) { root.appendChild(el("p", "notice warn", "config.js에 Supabase 설정이 필요해요.")); return; }
    if (!state.checked) return;
    if (!state.session) { root.appendChild(loginForm()); return; }
    if (!state.isAdmin) {
      root.appendChild(el("p", "notice warn", (state.session.user.email || "") + " 계정은 관리자가 아니에요."));
      root.appendChild(logoutRow());
      return;
    }

    // 요일 탭
    var tabs = el("div", "daytabs"); tabs.setAttribute("role", "tablist");
    var today = kst().dow;
    DAYS.forEach(function (d) {
      var n = 0;
      ROOMS.forEach(function (r) { HOURS.forEach(function (h) { if (state.lessons[key(d, r.k, h)]) n++; }); });
      var b = el("button", "daytab" + (d === state.day ? " on" : "") + (d === today ? " today" : ""));
      b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", d === state.day ? "true" : "false");
      b.appendChild(el("span", "dname", DAY_NAME[d]));
      b.appendChild(el("span", "dcount", n ? String(n) : ""));
      b.onclick = function () { state.day = d; render(); };
      tabs.appendChild(b);
    });
    root.appendChild(tabs);

    var sh = el("div", "sheet lessons-sheet");
    sh.appendChild(el("div", "h t", DAY_NAME[state.day] + "요일"));
    ROOMS.forEach(function (r) { sh.appendChild(el("div", "h " + r.k, r.n)); });
    HOURS.forEach(function (h, idx) {
      var t = el("div", "time" + (idx % 2 ? " alt" : "") + (idx ? " hour" : ""));
      t.appendChild(el("span", null, hourLabel(h)));
      sh.appendChild(t);
      ROOMS.forEach(function (r) {
        var k = key(state.day, r.k, h), v = state.lessons[k];
        var c = el("button", "cell " + r.c + (idx ? " hour" : "") + (v ? " on lesson" : ""));
        c.type = "button";
        c.setAttribute("aria-pressed", v ? "true" : "false");
        c.setAttribute("aria-label", DAY_NAME[state.day] + "요일 " + r.n + " " + hourLabel(h) + (v ? " 수업 있음" : " 비어 있음"));
        if (v) c.appendChild(el("span", "nm", v));
        if (state.busy[k]) c.disabled = true;
        c.onclick = function () { toggle(state.day, r.k, h); };
        sh.appendChild(c);
      });
    });
    root.appendChild(sh);
    root.appendChild(logoutRow());
  }

  function logoutRow() {
    var row = el("div", "tools admin-foot");
    row.appendChild(el("span", "note", state.session.user.email || ""));
    var b = el("button", "btn link", "로그아웃"); b.type = "button";
    b.onclick = function () { sb.auth.signOut(); };
    row.appendChild(b);
    return row;
  }

  function loginForm() {
    var f = el("form", "login");
    var inp = el("input"); inp.type = "email"; inp.id = "admin-email"; inp.required = true;
    inp.placeholder = "관리자 이메일"; inp.autocomplete = "email"; inp.setAttribute("aria-label", "관리자 이메일");
    f.appendChild(inp);
    var sbtn = el("button", "btn primary", "로그인 링크 받기"); sbtn.type = "submit"; f.appendChild(sbtn);
    if (state.loginMsg) f.appendChild(el("p", null, state.loginMsg));
    f.onsubmit = function (e) {
      e.preventDefault(); sbtn.disabled = true;
      sb.auth.signInWithOtp({ email: inp.value.trim(), options: { emailRedirectTo: location.origin + location.pathname } })
        .then(function (res) {
          state.loginMsg = res.error ? "링크를 보내지 못했어요: " + res.error.message : "메일함에서 로그인 링크를 눌러 주세요.";
          render();
        });
    };
    return f;
  }

  // ---------- boot ----------
  render();
  if (sb) {
    sb.auth.getSession().then(function (res) {
      state.session = res.data && res.data.session;
      return checkAdmin();
    }).then(function () { render(); if (state.isAdmin) loadLessons(); });
    sb.auth.onAuthStateChange(function (_evt, session) {
      var had = !!state.session;
      state.session = session;
      if (!!session !== had) checkAdmin().then(function () { render(); if (state.isAdmin) loadLessons(); });
    });
  }
})();
