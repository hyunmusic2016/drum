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
    tab: location.hash === "#password" ? "password" : location.hash === "#content" ? "content" : "lessons",
    content: null, contentSaved: null, contentSaving: false
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
      state.lessons = m; state.saved = Object.assign({}, m); state.loaded = true;
      render();
    });
  }

  // 여러 칸을 한 번에 켜기/끄기 (화면에서만 바뀜, [저장]을 눌러야 저장)
  function setCells(d, cells, on) {
    cells = cells.filter(function (c) { return !!state.lessons[key(d, c.room, c.slot)] !== on; });
    if (!cells.length) return;
    cells.forEach(function (c) { if (on) state.lessons[key(d, c.room, c.slot)] = LABEL; else delete state.lessons[key(d, c.room, c.slot)]; });
    render();
  }
  // 저장된 것과 지금 화면의 차이
  function diff() {
    var add = [], del = [], saved = state.saved || {};
    Object.keys(state.lessons).forEach(function (k) { if (!saved[k]) add.push(k); });
    Object.keys(saved).forEach(function (k) { if (!state.lessons[k]) del.push(k); });
    return { add: add, del: del, n: add.length + del.length };
  }
  function parseKey(k) { var p = k.split(":"); return { weekday: +p[0], room: p[1], slot: +p[2] }; }
  function cancelEdits() { state.lessons = Object.assign({}, state.saved || {}); render(); }
  function saveEdits() {
    var df = diff(); if (!df.n || state.saving) return;
    state.saving = true; render();
    var jobs = [];
    if (df.add.length) jobs.push(sb.from("lesson_slots").upsert(df.add.map(function (k) { var c = parseKey(k); c.label = LABEL; return c; })));
    var groups = {};
    df.del.forEach(function (k) { var c = parseKey(k), g = c.weekday + ":" + c.room; (groups[g] = groups[g] || []).push(c.slot); });
    Object.keys(groups).forEach(function (g) {
      var p = g.split(":");
      jobs.push(sb.from("lesson_slots").delete().eq("weekday", +p[0]).eq("room", p[1]).in("slot", groups[g]));
    });
    Promise.all(jobs).then(function (res) {
      state.saving = false;
      var err = res.filter(function (x) { return x.error; })[0];
      if (err) {
        render();
        toast(/row-level security|permission/i.test(err.error.message) ? "저장 권한이 없어요." : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      state.saved = Object.assign({}, state.lessons);
      var dow = kst().dow;
      var addT = df.add.map(parseKey).filter(function (c) { return c.weekday === dow; });
      var delT = df.del.map(parseKey).filter(function (c) { return c.weekday === dow; });
      if (addT.length) syncToday(addT, true);
      if (delT.length) syncToday(delT, false);
      render();
      toast("저장했어요");
    }, function () { state.saving = false; render(); toast("저장하지 못했어요. 인터넷 연결을 확인해 주세요."); });
  }
  // 저장 안 한 변경이 있으면 페이지를 떠날 때 확인
  window.addEventListener("beforeunload", function (e) {
    if (state.isAdmin && ((state.saved && diff().n) || contentDirty())) { e.preventDefault(); e.returnValue = ""; }
  });
  // ⌘/Ctrl+S 로 저장
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyS" && state.isAdmin) {
      if (state.tab === "lessons") { e.preventDefault(); saveEdits(); }
      else if (state.tab === "content") { e.preventDefault(); saveContent(); }
    }
  });

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
    [["lessons", "정기 수업"], ["content", "안내 문구"], ["password", "비밀번호 변경"]].forEach(function (m) {
      var b = el("button", "menutab" + (state.tab === m[0] ? " on" : ""), m[1]);
      b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", state.tab === m[0] ? "true" : "false");
      b.onclick = function () { state.tab = m[0]; try { history.replaceState(null, "", "#" + m[0]); } catch (er) {} render(); };
      menu.appendChild(b);
    });
    // 일주일 정기 수업 합계 (1시간 = 1명, 30분 = 0.5)
    var total = 0;
    Object.keys(state.lessons).forEach(function () { total++; });
    var tc = el("span", "menutotal", String(total / 2) + "명");
    menu.appendChild(tc);
    root.appendChild(menu);
    if (state.tab === "password") { root.appendChild(passwordForm()); return; }
    if (state.tab === "content") { root.appendChild(contentForm()); return; }

    // 저장 / 취소
    var df = diff();
    var acts = el("div", "lesson-acts");
    if (df.n) acts.appendChild(el("span", "dirty", df.n + "칸 바뀜"));
    var cb = el("button", "btn", "취소"); cb.type = "button"; cb.disabled = !df.n || state.saving; cb.onclick = cancelEdits;
    var svb = el("button", "btn save-btn", state.saving ? "저장 중…" : "저장"); svb.type = "button";
    svb.disabled = !df.n || state.saving; svb.onclick = saveEdits;
    acts.appendChild(cb); acts.appendChild(svb);
    root.appendChild(acts);

    // 요일 탭
    var tabs = el("div", "daytabs"); tabs.setAttribute("role", "tablist");
    var today = kst().dow;
    DAYS.forEach(function (d) {
      var n = 0;
      ROOMS.forEach(function (r) { for (var q = 0; q < SLOTS; q++) if (state.lessons[key(d, r.k, q)]) n++; });
      var b = el("button", "daytab" + (d === state.day ? " on" : "") + (d === today ? " today" : ""));
      b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", d === state.day ? "true" : "false");
      b.appendChild(el("span", "dname", DAY_NAME[d]));
      b.appendChild(el("span", "dcount", n ? String(n / 2) : "")); // 30분 칸 2개 = 1시간 (8칸 → 4, 1칸 → 0.5)
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

  // ---------- 안내 문구 (예약표 오른쪽 칸): 상자 추가·삭제·숨김·순서·글씨 크기 ----------
  var SC = window.SiteContent;
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function loadContent() {
    return sb.from("site_content").select("key,value").then(function (res) {
      if (res.error) toast("안내 문구를 불러오지 못했어요. site_content.sql을 실행했는지 확인해 주세요.");
      state.content = res.error ? SC.defaults() : SC.fromRows(res.data);
      state.contentSaved = clone(state.content);
      state.cset = res.error ? Object.assign({}, SC.SETTINGS) : SC.settingsFromRows(res.data);
      state.csetSaved = clone(state.cset);
      render();
    });
  }
  function contentDirty() {
    return !!state.content && (JSON.stringify(state.content) !== JSON.stringify(state.contentSaved) ||
      JSON.stringify(state.cset) !== JSON.stringify(state.csetSaved));
  }
  function contentForm() {
    var wrap = el("div", "content-edit");
    if (!state.content) { wrap.appendChild(el("p", "note", "불러오는 중…")); if (!state.contentLoading) { state.contentLoading = true; loadContent().then(function () { state.contentLoading = false; }); } return wrap; }
    var boxes = state.content;
    var form = el("div", "cform"), pv = el("aside", "info cpreview");
    var acts = el("div", "lesson-acts");
    function refresh() { SC.applySettings(pv, state.cset); pv.innerHTML = SC.render(boxes); SC.drawQr(pv); bar(); }

    // 전체 설정: 자간
    var gset = el("div", "cbox cglobal");
    var lsl = el("label", "csize"); lsl.appendChild(document.createTextNode("전체 자간 "));
    var ls = el("input"); ls.type = "range"; ls.min = -0.1; ls.max = 0.05; ls.step = 0.005; ls.value = state.cset.letterSpacing || 0;
    ls.setAttribute("aria-label", "전체 자간");
    function lsText(v) { v = Math.round(v * 1000) / 10; return (v > 0 ? "+" : "") + v + "%"; }
    var lsv = el("span", "cszv", lsText(+ls.value));
    ls.oninput = function () { state.cset.letterSpacing = +ls.value; lsv.textContent = lsText(+ls.value); refresh(); };
    lsl.appendChild(ls); lsl.appendChild(lsv);
    var lsr = el("button", "btn ib", "기본"); lsr.type = "button";
    lsr.onclick = function () { state.cset.letterSpacing = 0; ls.value = 0; lsv.textContent = lsText(0); refresh(); };
    gset.appendChild(lsl); gset.appendChild(lsr);
    form.appendChild(gset);
    function move(i, d) { var j = i + d; if (j < 0 || j >= boxes.length) return; var t = boxes[i]; boxes[i] = boxes[j]; boxes[j] = t; render(); }

    boxes.forEach(function (b, i) {
      var card = el("div", "cbox" + (b.hidden ? " is-hidden" : ""));
      // 위쪽 줄: 제목 / 순서 / 숨김 / 삭제
      var top = el("div", "cbox-top");
      var ti = el("input", "ctitle"); ti.type = "text"; ti.value = b.title || ""; ti.placeholder = b.type === "qr" ? "제목 (없으면 비워 두기)" : "제목";
      ti.setAttribute("aria-label", "상자 제목"); ti.oninput = function () { b.title = ti.value; refresh(); };
      top.appendChild(ti);
      function ib(txt, label, fn, dis) { var x = el("button", "btn ib", txt); x.type = "button"; x.title = label; x.setAttribute("aria-label", label); x.disabled = !!dis; x.onclick = fn; return x; }
      top.appendChild(ib("↑", "위로", function () { move(i, -1); }, i === 0));
      top.appendChild(ib("↓", "아래로", function () { move(i, 1); }, i === boxes.length - 1));
      top.appendChild(ib(b.hidden ? "보이기" : "숨기기", b.hidden ? "보이기" : "숨기기", function () { b.hidden = !b.hidden; render(); }));
      var del = ib("삭제", "삭제", null);
      del.classList.add("danger");
      del.onclick = function () {
        if (del.dataset.armed) { boxes.splice(i, 1); render(); return; }
        del.dataset.armed = "1"; del.textContent = "삭제 확인"; del.setAttribute("aria-label", "삭제 확인");
        setTimeout(function () { if (del.isConnected) { delete del.dataset.armed; del.textContent = "삭제"; del.setAttribute("aria-label", "삭제"); } }, 3000);
      };
      top.appendChild(del);
      card.appendChild(top);

      // 모양 / 글씨 크기
      var opt = el("div", "cbox-opt");
      if (b.type !== "qr") {
        var sel = el("select", "csel"); sel.setAttribute("aria-label", "모양");
        SC.STYLES.forEach(function (st) { var o = el("option", null, st[1]); o.value = st[0]; if (b.style === st[0]) o.selected = true; sel.appendChild(o); });
        sel.onchange = function () { b.style = sel.value; refresh(); };
        opt.appendChild(sel);
      }
      var szl = el("label", "csize"); szl.appendChild(document.createTextNode(b.type === "qr" ? "글씨 " : "글씨 "));
      var rg = el("input"); rg.type = "range"; rg.min = 70; rg.max = 160; rg.step = 5; rg.value = b.scale || 100; rg.setAttribute("aria-label", "글씨 크기");
      var rv = el("span", "cszv", (b.scale || 100) + "%");
      rg.oninput = function () { b.scale = +rg.value; rv.textContent = rg.value + "%"; refresh(); };
      szl.appendChild(rg); szl.appendChild(rv);
      opt.appendChild(szl);
      if (b.type === "qr") { // 이미지 크기는 글씨와 따로
        var iml = el("label", "csize"); iml.appendChild(document.createTextNode("이미지 "));
        var ir = el("input"); ir.type = "range"; ir.min = 40; ir.max = 200; ir.step = 5; ir.value = b.imgScale || 100; ir.setAttribute("aria-label", "이미지 크기");
        var iv = el("span", "cszv", (b.imgScale || 100) + "%");
        ir.oninput = function () { b.imgScale = +ir.value; iv.textContent = ir.value + "%"; refresh(); };
        iml.appendChild(ir); iml.appendChild(iv);
        opt.appendChild(iml);
      }
      card.appendChild(opt);

      // QR 이미지
      if (b.type === "qr") {
        var qrow = el("div", "qrow");
        var file = el("input"); file.type = "file"; file.accept = "image/*"; file.hidden = true;
        var up = el("button", "btn", "이미지 올리기"); up.type = "button"; up.onclick = function () { file.click(); };
        var reset = el("button", "btn", "자동 QR로"); reset.type = "button"; reset.disabled = !b.image;
        reset.onclick = function () { b.image = ""; render(); };
        file.onchange = function () {
          var f = file.files && file.files[0]; if (!f) return;
          if (!/^image\//.test(f.type)) { toast("이미지 파일만 올릴 수 있어요."); return; }
          if (f.size > 3 * 1024 * 1024) { toast("3MB 이하 이미지만 올릴 수 있어요."); return; }
          up.disabled = true; up.textContent = "올리는 중…";
          var ext = (f.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
          var path = "qr-" + Date.now() + "." + ext;
          sb.storage.from("site").upload(path, f, { contentType: f.type, upsert: true }).then(function (res) {
            if (res.error) { up.disabled = false; up.textContent = "이미지 올리기"; toast("올리지 못했어요: " + res.error.message); return; }
            b.image = sb.storage.from("site").getPublicUrl(path).data.publicUrl;
            render();
          }, function () { up.disabled = false; up.textContent = "이미지 올리기"; toast("올리지 못했어요. 인터넷 연결을 확인해 주세요."); });
        };
        qrow.appendChild(up); qrow.appendChild(reset); qrow.appendChild(file);
        qrow.appendChild(el("span", "qstate", b.image ? "올린 이미지" : "자동 QR"));
        card.appendChild(qrow);
      }

      var ta = el("textarea", "cbody"); ta.rows = Math.min(12, Math.max(4, (b.body || "").split("\n").length + 1));
      ta.value = b.body || ""; ta.setAttribute("aria-label", (b.title || "상자") + " 내용");
      ta.oninput = function () { b.body = ta.value; refresh(); };
      card.appendChild(ta);
      form.appendChild(card);
    });

    // 상자 추가
    var addRow = el("div", "qrow");
    var at = el("button", "btn", "+ 글 상자 추가"); at.type = "button";
    at.onclick = function () { boxes.push(SC.newText()); render(); };
    addRow.appendChild(at);
    if (!boxes.some(function (b) { return b.type === "qr"; })) {
      var aq = el("button", "btn", "+ QR 상자 추가"); aq.type = "button";
      aq.onclick = function () { boxes.push(SC.newQr()); render(); };
      addRow.appendChild(aq);
    }
    form.appendChild(addRow);
    form.appendChild(el("p", "chint", "빈 줄 = 항목 나누기 · **글자** = 굵게 · 줄 맨 앞 ! = 빨간 글씨 · {주소} = 이 페이지 주소"));

    function bar() {
      acts.textContent = "";
      var dirty = contentDirty();
      if (dirty) acts.appendChild(el("span", "dirty", "저장 안 됨"));
      var cb = el("button", "btn", "취소"); cb.type = "button"; cb.disabled = !dirty || state.contentSaving;
      cb.onclick = function () { state.content = clone(state.contentSaved); state.cset = clone(state.csetSaved); render(); };
      var sv = el("button", "btn save-btn", state.contentSaving ? "저장 중…" : "저장"); sv.type = "button";
      sv.disabled = !dirty || state.contentSaving; sv.onclick = saveContent;
      var pvb = el("button", "btn", "홈 화면 미리보기"); pvb.type = "button"; pvb.onclick = openHomePreview;
      acts.insertBefore(pvb, acts.firstChild);
      acts.appendChild(cb); acts.appendChild(sv);
    }
    wrap.appendChild(acts);
    var cols = el("div", "ccols"); cols.appendChild(form); cols.appendChild(pv);
    wrap.appendChild(cols);
    refresh();
    return wrap;
  }
  // 실제 홈 화면에 저장 전 문구를 넣어 보여 주는 창
  function openHomePreview() {
    var draft = JSON.parse(JSON.stringify(state.content)), draftSet = clone(state.cset);
    var ov = el("div", "pv-overlay"); ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "홈 화면 미리보기");
    var top = el("div", "pv-top");
    top.appendChild(el("strong", null, "홈 화면 미리보기" + (contentDirty() ? " (저장 전)" : "")));
    var seg = el("div", "pv-seg");
    var frameWrap = el("div", "pv-frame");
    var fr = el("iframe"); fr.src = "index.html?preview=1"; fr.title = "홈 화면 미리보기";
    frameWrap.appendChild(fr);
    [["pc", "컴퓨터"], ["mobile", "휴대폰"]].forEach(function (m, i) {
      var b = el("button", "btn" + (i === 0 ? " on" : ""), m[1]); b.type = "button";
      b.onclick = function () { seg.querySelectorAll(".btn").forEach(function (x) { x.classList.remove("on"); }); b.classList.add("on"); frameWrap.classList.toggle("mobile", m[0] === "mobile"); };
      seg.appendChild(b);
    });
    top.appendChild(seg);
    var close = el("button", "btn", "닫기"); close.type = "button";
    // 미리보기 창이 준비되면 저장 전 문구를 보냄
    function onMsg(e) {
      if (e.source === fr.contentWindow && e.data && e.data.type === "preview-ready")
        fr.contentWindow.postMessage({ type: "draftBoxes", boxes: draft, settings: draftSet }, "*");
    }
    window.addEventListener("message", onMsg);
    function shut() { ov.remove(); document.removeEventListener("keydown", onKey); window.removeEventListener("message", onMsg); }
    function onKey(e) { if (e.key === "Escape") shut(); }
    close.onclick = shut;
    document.addEventListener("keydown", onKey);
    top.appendChild(close);
    ov.appendChild(top); ov.appendChild(frameWrap);
    document.body.appendChild(ov);
    close.focus();
  }
  function saveContent() {
    if (!contentDirty() || state.contentSaving) return;
    state.contentSaving = true; render();
    var now = new Date().toISOString();
    sb.from("site_content").upsert([
      { key: "boxes", value: JSON.stringify(state.content), updated_at: now },
      { key: "info_settings", value: JSON.stringify(state.cset), updated_at: now }
    ]).then(function (res) {
      state.contentSaving = false;
      if (res.error) { render(); toast(/row-level security|permission/i.test(res.error.message) ? "저장 권한이 없어요." : "저장하지 못했어요: " + res.error.message); return; }
      state.contentSaved = clone(state.content); state.csetSaved = clone(state.cset);
      render(); toast("저장했어요");
    }, function () { state.contentSaving = false; render(); toast("저장하지 못했어요. 인터넷 연결을 확인해 주세요."); });
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
