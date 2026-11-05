(function () {
  "use strict";
  var aside = document.getElementById("info");
  if (!aside || !window.SiteContent) return;
  var SC = window.SiteContent, boxes = SC.defaults();

  function paint() {
    aside.innerHTML = SC.render(boxes);
    SC.drawQr(aside);
    aside.querySelectorAll(".qr-img").forEach(function (img) { img.addEventListener("load", fit); });
    fit();
  }

  // 표와 위아래를 딱 맞춤: 안내 칸 높이 = 표 높이, 넘치면 글씨를 조금씩 줄임
  function fit() {
    var sheet = document.querySelector(".wrap.home .sheet");
    var side = sheet && aside.getBoundingClientRect().left > sheet.getBoundingClientRect().right;
    aside.style.removeProperty("--info-fs");
    if (!side) { aside.style.height = ""; aside.classList.remove("fitted"); return; }
    var h = sheet.offsetHeight;
    aside.classList.add("fitted");
    aside.style.height = h + "px";
    var fs = 14;
    aside.style.setProperty("--info-fs", fs + "px");
    while (natural() > h && fs > 10) { fs -= 0.5; aside.style.setProperty("--info-fs", fs + "px"); }
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
  paint();
  if (cfg.SUPABASE_URL && window.supabase) {
    var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: "sb-info" } });
    sb.from("site_content").select("key,value").then(function (res) {
      if (res.error || !res.data) return;
      boxes = SC.fromRows(res.data);
      paint();
    }, function () {});
  }
})();
