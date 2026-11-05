(function () {
  "use strict";
  var aside = document.getElementById("info");
  if (!aside || !window.SiteContent) return;
  var SC = window.SiteContent, boxes = SC.defaults(), settings = Object.assign({}, SC.SETTINGS);
  // 관리자 [안내 문구] 오른쪽 미리보기: 홈 화면과 똑같은 코드로 안내 칸만 보여 줌
  var INFO_ONLY = /[?&]infoonly=1/.test(location.search) && window.parent !== window;
  if (INFO_ONLY) document.documentElement.classList.add("info-only");

  function paint() {
    SC.applySettings(aside, settings);
    aside.innerHTML = SC.render(boxes);
    SC.drawQr(aside);
    aside.querySelectorAll(".qr-img").forEach(function (img) { img.addEventListener("load", fit); });
    fit();
  }

  // 표와 위아래를 딱 맞춤: 안내 칸 높이 = 표 높이, 넘치면 글씨를 조금씩 줄임
  function fit() {
    var sheet = document.querySelector(".wrap.home .sheet");
    var side = sheet && (INFO_ONLY || aside.getBoundingClientRect().left > sheet.getBoundingClientRect().right);
    aside.style.removeProperty("--info-fs");
    if (!side) { aside.style.height = ""; aside.classList.remove("fitted"); return; }
    var h = sheet.offsetHeight;
    aside.classList.add("fitted");
    aside.style.height = h + "px";
    var fs = 14;
    aside.style.setProperty("--info-fs", fs + "px");
    while (natural() > h && fs > 10) { fs -= 0.5; aside.style.setProperty("--info-fs", fs + "px"); }
    if (INFO_ONLY) window.parent.postMessage({ type: "preview-size", h: h }, "*");
  }
  function natural() {
    var t = 0, boxes = aside.querySelectorAll(".info-box");
    for (var i = 0; i < boxes.length; i++) t += boxes[i].scrollHeight + 2;
    return t + (boxes.length - 1) * 10;
  }
  document.addEventListener("sheet-layout", fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit); // 폰트가 늦게 오면 다시 맞춤
  window.addEventListener("resize", fit);

  // 관리자가 고친 문구 불러오기 (못 불러오면 기본 문구)
  var cfg = window.APP_CONFIG || {};
  // 관리자 미리보기: 저장 전 문구를 부모 창(admin.html)에서 받아 그림
  if (/[?&]preview=1/.test(location.search) && window.parent !== window) {
    window.addEventListener("message", function (e) {
      if (e.source !== window.parent || !e.data || e.data.type !== "draftBoxes") return;
      boxes = e.data.boxes || boxes; settings = e.data.settings || settings; paint();
    });
    paint();
    window.parent.postMessage({ type: "preview-ready" }, "*");
    return;
  }
  paint();
  if (cfg.SUPABASE_URL && window.supabase) {
    var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: "sb-info" } });
    sb.from("site_content").select("key,value").then(function (res) {
      if (res.error || !res.data) return;
      boxes = SC.fromRows(res.data); settings = SC.settingsFromRows(res.data);
      paint();
    }, function () {});
  }
})();
