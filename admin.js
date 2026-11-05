(function () {
  "use strict";

  var ROOMS = [
    { k: "band", n: "합주실", c: "b" },
    { k: "drum", n: "드럼연습실", c: "d" }
  ];
  var SLOTS = 18, START = 13 * 60;                     // 30분 칸: 0 = 1:00~1:30 ... 17 = 9:30~10:00 (예약표와 같음)
  var KB = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var DAYS = [1, 2, 3, 4, 5, 6, 0];                    // 월 ~ 일
  var DAY_NAME = ["일", "월", "화", "수", "목", "금", "토"];
  var LABEL = "수업";

  var cfg = window.APP_CONFIG || {};
  var sb = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  var state = {
    session: null, isAdmin: false, checked: false,
    lessons: {},          // "weekday:room:slot" -> label
    loaded: false, day: kst().dow, busy: {}, loginMsg: "", pwMsg: "",
    tab: location.hash === "#password" ? "password" : "lessons"
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
  function slotLabel(i) {
    var s = START + i * 30, e = s + 30;
    function f(t) { var h = Math.floor(t / 60) % 12 || 12; return h + ":" + (t % 60 ? "30" : "00"); }
    return f(s) + "~" + f(e);
  }

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
    return sb.from("lesson_slots").select("weekday,room,slot,label").then(function (res) {
      if (res.error) { toast("수업 시간표를 불러오지 못했어요. lessons_30min.sql을 실행했는지 확인해 주세요."); return; }
      var m = {};
      (res.data || []).forEach(function (l) { m[key(l.weekday, l.room, l.slot)] = l.label; });
      state.lessons = m; state.loaded = true;
      render();
    });
  }

  // 여러 칸을 한 번에 켜기/끄기 (cells: [{room, slot}], on: true=수업 넣기)
  function setCells(d, cells, on) {
    cells = cells.filter(function (c) { return !!state.lessons[key(d, c.room, c.slot)] !== on; });
    if (!cells.length) return;
    cells.forEach(function (c) { if (on) state.lessons[key(d, c.room, c.slot)] = LABEL; else delete state.lessons[key(d, c.room, c.slot)]; });
    render();
    var jobs = [];
    if (on) jobs.push(sb.from("lesson_slots").upsert(cells.map(function (c) { return { weekday: d, room: c.room, slot: c.slot, label: LABEL }; })));
    else ROOMS.forEach(function (r) {
      var sl = cells.filter(function (c) { return c.room === r.k; }).map(function (c) { return c.slot; });
      if (sl.length) jobs.push(sb.from("lesson_slots").delete().eq("weekday", d).eq("room", r.k).in("slot", sl));
    });
    function undoLocal() {
      cells.forEach(function (c) { if (on) delete state.lessons[key(d, c.room, c.slot)]; else state.lessons[key(d, c.room, c.slot)] = LABEL; });
      render();
    }
    Promise.all(jobs).then(function (res) {
      var err = res.filter(function (x) { return x.error; })[0];
      if (err) {
        undoLocal();
        toast(/row-level security|permission/i.test(err.error.message) ? "저장 권한이 없어요." : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      if (d === kst().dow) syncToday(cells, on);
    }, function () { undoLocal(); toast("저장하지 못했어요. 인터넷 연결을 확인해 주세요."); });
  }

  // 오늘 요일을 바꾸면 오늘 예약표에도 바로 반영 (다른 예약이 있는 칸은 건드리지 않음)
  function syncToday(cells, on) {
    var day = kst().date;
    if (on) {
      sb.from("reservations").upsert(cells.map(function (c) { return { day: day, room: c.room, slot: c.slot, name: LABEL }; }),
        { onConflict: "day,room,slot", ignoreDuplicates: true }).then(function () {}, function () {});
    } else ROOMS.forEach(function (r) {
      var sl = cells.filter(function (c) { return c.room === r.k; }).map(function (c) { return c.slot; });
      if (sl.length) sb.from("reservations").delete().eq("day", day).eq("room", r.k).eq("name", LABEL).in("slot", sl)
        .then(function () {}, function () {});
    });
  }

  // ---------- 드래그로 칠하기 (마우스) ----------
  // 누른 칸이 비어 있으면 '수업 넣기', 차 있으면 '지우기'. 끄는 동안 같은 방 칸들을 미리 표시하고 놓으면 저장
  var paint = null;
  function paintCells() {
    if (!paint) return [];
    var lo = Math.min(paint.from, paint.to), hi = Math.max(paint.from, paint.to), out = [];
    for (var k = lo; k <= hi; k++) out.push({ room: paint.room, slot: k });
    return out;
  }
  function paintPreview() {
    document.querySelectorAll(".lessons-sheet .cell").forEach(function (c) { c.classList.remove("pv-on", "pv-off"); });
    paintCells().forEach(function (c) {
      var e = document.querySelector('.lessons-sheet .cell[data-room="' + c.room + '"][data-slot="' + c.slot + '"]');
      if (e) e.classList.add(paint.on ? "pv-on" : "pv-off");
    });
  }
  function slotAtY(y) {
    var times = document.querySelectorAll(".lessons-sheet > .time");
    for (var k = 0; k < times.length; k++) if (y < times[k].getBoundingClientRect().bottom) return k;
    return times.length - 1;
  }
  document.addEventListener("pointermove", function (e) {
    if (!paint) return;
    var t = slotAtY(e.clientY);
    if (t !== paint.to) { paint.to = t; paintPreview(); }
  });
  document.addEventListener("pointerup", function () {
    if (!paint) return;
    var p = paint, cells = paintCells(); paint = null;
    document.body.classList.remove("filling");
    setCells(p.day, cells, p.on);
  });

  // ---------- render ----------
  function render() {
    var root = document.getElementById("root");
    root.textContent = "";

    var hd = el("header"), l = el("div");
    l.appendChild(el("div", "eyebrow", "ADMIN"));
    l.appendChild(el("h1", null, state.checked && !state.session ? "관리자 로그인" : "관리자 페이지"));
    hd.appendChild(l);
    var back = el("a", "btn", "예약표로"); back.href = "./";
    var tools = el("div", "tools"); tools.appendChild(back);
    if (state.session) {
      var lo = el("button", "btn", "로그아웃"); lo.type = "button";
      lo.onclick = function () { sb.auth.signOut(); };
      tools.appendChild(lo);
    }
    hd.appendChild(tools);
    root.appendChild(hd);

    if (!sb) { root.appendChild(el("p", "notice warn", "config.js에 Supabase 설정이 필요해요.")); return; }
    if (!state.checked) return;
    if (!state.session) { root.appendChild(loginForm()); return; } // 로그인 안 했으면 로그인 화면
    if (!state.isAdmin) {
      root.appendChild(el("p", "notice warn", (state.session.user.email || "") + " 계정은 관리자가 아니에요."));
      return;
    }

    // 메뉴 탭: 정기 수업 / 비밀번호 변경
    var menu = el("div", "menutabs"); menu.setAttribute("role", "tablist");
    [["lessons", "정기 수업"], ["password", "비밀번호 변경"]].forEach(function (m) {
      var b = el("button", "menutab" + (state.tab === m[0] ? " on" : ""), m[1]);
      b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", state.tab === m[0] ? "true" : "false");
      b.onclick = function () { state.tab = m[0]; try { history.replaceState(null, "", "#" + m[0]); } catch (er) {} render(); };
      menu.appendChild(b);
    });
    root.appendChild(menu);
    if (state.tab === "password") { root.appendChild(passwordForm()); return; }

    // 요일 탭
    var tabs = el("div", "daytabs"); tabs.setAttribute("role", "tablist");
    var today = kst().dow;
    DAYS.forEach(function (d) {
      var n = 0;
      ROOMS.forEach(function (r) { for (var q = 0; q < SLOTS; q++) if (state.lessons[key(d, r.k, q)]) n++; });
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
    for (var i = 0; i < SLOTS; i++) (function (i) {
      var hour = i > 0 && i % 2 === 0, alt = Math.floor(i / 2) % 2 === 1;
      var t = el("div", "time" + (alt ? " alt" : "") + (hour ? " hour" : ""));
      t.appendChild(el("span", null, slotLabel(i)));
      sh.appendChild(t);
      ROOMS.forEach(function (r) {
        var v = state.lessons[key(state.day, r.k, i)];
        var c = el("button", "cell " + r.c + (hour ? " hour" : "") + (v ? " on lesson" : ""));
        c.type = "button"; c.dataset.room = r.k; c.dataset.slot = i;
        c.setAttribute("aria-pressed", v ? "true" : "false");
        c.setAttribute("aria-label", DAY_NAME[state.day] + "요일 " + r.n + " " + slotLabel(i) + (v ? " 수업 있음" : " 비어 있음"));
        if (v) c.appendChild(el("span", "nm", v));
        if (KB) {
          c.addEventListener("pointerdown", function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            paint = { day: state.day, room: r.k, from: i, to: i, on: !v };
            document.body.classList.add("filling");
            paintPreview();
          });
        } else {
          c.onclick = function () { setCells(state.day, [{ room: r.k, slot: i }], !v); };
        }
        sh.appendChild(c);
      });
    })(i);
    root.appendChild(sh);
    root.appendChild(el("p", "memo", "나중에 출석부가 새로 만들어지면 출석부 드럼 시간이랑 자동연동하기"));
  }

  function passwordForm() {
    var f = el("form", "pwform");
    function field(id, ph, ac) {
      var i = el("input"); i.type = "password"; i.id = id; i.required = true; i.placeholder = ph;
      i.autocomplete = ac; i.setAttribute("aria-label", ph); f.appendChild(i); return i;
    }
    var cur = field("pw-current", "현재 비밀번호", "current-password");
    var nw = field("pw-new", "새 비밀번호 (6자 이상)", "new-password");
    var nw2 = field("pw-new2", "새 비밀번호 확인", "new-password");
    var b = el("button", "btn primary", "비밀번호 변경"); b.type = "submit"; f.appendChild(b);
    if (state.pwMsg) f.appendChild(el("p", "login-err", state.pwMsg));
    function fail(msg) { state.pwMsg = msg; b.disabled = false; var old = f.querySelector(".login-err"); if (old) old.remove(); f.appendChild(el("p", "login-err", msg)); }
    f.onsubmit = function (e) {
      e.preventDefault();
      if (nw.value.length < 6) return fail("새 비밀번호는 6자 이상이어야 해요.");
      if (nw.value !== nw2.value) return fail("새 비밀번호가 서로 달라요.");
      if (nw.value === cur.value) return fail("지금 비밀번호와 다른 비밀번호를 넣어 주세요.");
      b.disabled = true;
      var email = state.session.user.email;
      // 현재 비밀번호가 맞는지 먼저 확인
      sb.auth.signInWithPassword({ email: email, password: cur.value }).then(function (r1) {
        if (r1.error) return fail("현재 비밀번호가 맞지 않아요.");
        return sb.auth.updateUser({ password: nw.value }).then(function (r2) {
          if (r2.error) return fail("바꾸지 못했어요: " + r2.error.message);
          state.pwMsg = ""; cur.value = nw.value = nw2.value = ""; b.disabled = false;
          var old = f.querySelector(".login-err"); if (old) old.remove();
          toast("비밀번호를 바꿨어요");
        });
      }, function () { fail("바꾸지 못했어요. 인터넷 연결을 확인해 주세요."); });
    };
    return f;
  }

  function loginForm() {
    var f = el("form", "login");
    var inp = el("input"); inp.type = "email"; inp.id = "admin-email"; inp.required = true;
    inp.placeholder = "이메일"; inp.autocomplete = "username"; inp.setAttribute("aria-label", "관리자 이메일");
    var pw = el("input"); pw.type = "password"; pw.id = "admin-password"; pw.required = true;
    pw.placeholder = "비밀번호"; pw.autocomplete = "current-password"; pw.setAttribute("aria-label", "비밀번호");
    f.appendChild(inp); f.appendChild(pw);
    var sbtn = el("button", "btn primary", "로그인"); sbtn.type = "submit"; f.appendChild(sbtn);
    if (state.loginMsg) f.appendChild(el("p", "login-err", state.loginMsg));
    f.onsubmit = function (e) {
      e.preventDefault(); sbtn.disabled = true;
      sb.auth.signInWithPassword({ email: inp.value.trim(), password: pw.value }).then(function (res) {
        if (res.error) {
          state.loginMsg = /invalid/i.test(res.error.message) ? "이메일 또는 비밀번호가 맞지 않아요." : "로그인하지 못했어요: " + res.error.message;
          render();
        } else state.loginMsg = "";
      }, function () { state.loginMsg = "로그인하지 못했어요. 인터넷 연결을 확인해 주세요."; render(); });
    };
    setTimeout(function () { inp.focus(); }, 0);
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
