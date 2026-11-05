(function () {
  "use strict";

  // 로그인 후 갈 곳: ?next=... (같은 사이트 안의 페이지만), 기본은 관리자 페이지
  var next = (function () {
    var m = /[?&]next=([^&#]+)/.exec(location.search);
    var v = m ? decodeURIComponent(m[1]) : "admin.html";
    return /^[a-z0-9_\-./]*$/i.test(v) && v.indexOf("//") === -1 ? v : "admin.html";
  })();

  var cfg = window.APP_CONFIG || {};
  var sb = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  var state = { session: null, checked: false, isAdmin: false, msg: "" };

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function checkAdmin() {
    if (!state.session) { state.isAdmin = false; return Promise.resolve(); }
    return sb.from("admins").select("email").eq("email", state.session.user.email).maybeSingle()
      .then(function (res) { state.isAdmin = !!(res.data && !res.error); });
  }

  function render() {
    var root = document.getElementById("root");
    root.textContent = "";
    var hd = el("header"), l = el("div");
    l.appendChild(el("div", "eyebrow", "ADMIN"));
    l.appendChild(el("h1", null, "관리자 로그인"));
    hd.appendChild(l);
    var back = el("a", "btn", "예약표로"); back.href = "./";
    var tools = el("div", "tools"); tools.appendChild(back); hd.appendChild(tools);
    root.appendChild(hd);

    if (!sb) { root.appendChild(el("p", "notice warn", "config.js에 Supabase 설정이 필요해요.")); return; }
    if (!state.checked) return;

    if (state.session && !state.isAdmin) {
      root.appendChild(el("p", "notice warn", (state.session.user.email || "") + " 계정은 관리자가 아니에요."));
      var lo = el("button", "btn", "로그아웃"); lo.type = "button";
      lo.onclick = function () { sb.auth.signOut(); };
      root.appendChild(lo);
      return;
    }

    var f = el("form", "login");
    var inp = el("input"); inp.type = "email"; inp.id = "admin-email"; inp.required = true;
    inp.placeholder = "이메일"; inp.autocomplete = "username"; inp.setAttribute("aria-label", "관리자 이메일");
    var pw = el("input"); pw.type = "password"; pw.id = "admin-password"; pw.required = true;
    pw.placeholder = "비밀번호"; pw.autocomplete = "current-password"; pw.setAttribute("aria-label", "비밀번호");
    f.appendChild(inp); f.appendChild(pw);
    var sbtn = el("button", "btn primary", "로그인"); sbtn.type = "submit"; f.appendChild(sbtn);
    if (state.msg) f.appendChild(el("p", "login-err", state.msg));
    f.onsubmit = function (e) {
      e.preventDefault(); sbtn.disabled = true;
      sb.auth.signInWithPassword({ email: inp.value.trim(), password: pw.value }).then(function (res) {
        if (res.error) {
          state.msg = /invalid/i.test(res.error.message) ? "이메일 또는 비밀번호가 맞지 않아요." : "로그인하지 못했어요: " + res.error.message;
          render();
        }
      }, function () { state.msg = "로그인하지 못했어요. 인터넷 연결을 확인해 주세요."; render(); });
    };
    root.appendChild(f);
    setTimeout(function () { inp.focus(); }, 0);
  }

  function update(session) {
    state.session = session;
    checkAdmin().then(function () {
      state.checked = true;
      if (state.session && state.isAdmin) { location.replace(next); return; }
      render();
    });
  }

  render();
  if (sb) {
    sb.auth.getSession().then(function (res) { update(res.data && res.data.session); });
    sb.auth.onAuthStateChange(function (_evt, session) { if (state.checked) update(session); });
  }
})();
