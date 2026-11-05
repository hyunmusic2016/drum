// 예약표 오른쪽 안내 칸: 상자 목록과 그리는 방법 (index.html, admin.html 공용)
// 상자 = { id, type: "text"|"qr", title, body, style: "list"|"alert"|"plain", scale(%), hidden, image }
// 문구 규칙: 빈 줄로 항목 구분, 항목 안의 줄바꿈은 그대로, **굵게**, 줄 맨 앞 ! = 빨간 굵은 글씨, {주소} = 이 페이지 주소
(function () {
  "use strict";
  var OLD = { // v1.37.0 의 기본 문구 (예전 저장값을 상자로 옮길 때도 씀)
    usage_title: "이용안내",
    usage: "당일 예약과 방문 예약만 가능합니다.\n\n하루에 예약할 수 있는 시간은 총 2시간입니다.\n\n예약 시간 이후 10분간 입실하지 않을 시 연습실 사용은 취소되며, 연습실 내 연습하는 사람이 없으면 사용은 취소됩니다.\n\n본 페이지는 어쿠스틱 드럼 연습실 예약페이지 입니다. 전자 드럼 연습실은 상시 이용 가능합니다.\n\n!해당 PC에서 연습실 예약 외 다른 작업은 불가합니다.",
    caution_title: "유의사항",
    caution: "연습실내 물 이외 음식물 반입금지\n(드럼 카페트 오염시 변상)\n\n방음문 살살 닫기\n(문 고장시 수리비 청구)",
    howto_title: "예약방법",
    howto: "① 예약을 원하시는 시간대에 본인의 이름을 기입하시면 됩니다.\n**· 처음 예약은 최대 1시간 가능하며, 1시간 연습 후 다음 예약자가 없으면 30분 단위로 1시간 연장 가능합니다.**\n\n② 30분만 예약이 가능합니다.\n\n③ **'수업'**, **'종료'** 란은 수강생이 임의로 수정 및 삭제가 불가능 합니다.",
    qr_text: "(해당페이지 URL QR코드)\n{주소}\n\n본 예약페이지는 외부에서 열람 가능합니다.\n(예약 불가, 열람만 가능)\n\n학원 오시기 전 연습실 예약 현황을 확인 해보세요!",
    qr_image: ""
  };
  var STYLES = [["list", "목록 (·)"], ["alert", "가운데 빨강"], ["plain", "일반"], ["center", "가운데"]];

  function uid() { return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function box(type, title, body, style, extra) {
    return Object.assign({ id: uid(), type: type, title: title, body: body, style: style, scale: 100, hidden: false, image: "" }, extra || {});
  }
  // 예전 키(usage, caution …) → 상자 목록
  function fromOld(o) {
    o = Object.assign({}, OLD, o || {});
    return [
      box("text", o.usage_title, o.usage, "list", { id: "usage" }),
      box("text", o.caution_title, o.caution, "alert", { id: "caution" }),
      box("text", o.howto_title, o.howto, "plain", { id: "howto" }),
      box("qr", "", o.qr_text, "center", { id: "qr", image: o.qr_image || "" })
    ];
  }
  function defaults() { return fromOld({}); }
  // site_content 의 행들 → 상자 목록
  function fromRows(rows) {
    var m = {};
    (rows || []).forEach(function (r) { m[r.key] = r.value; });
    if (m.boxes) {
      try {
        var b = JSON.parse(m.boxes);
        if (Array.isArray(b)) return b.map(function (x) { return Object.assign(box(x.type === "qr" ? "qr" : "text", "", "", "list"), x); });
      } catch (e) {}
    }
    return fromOld(m);
  }
  function newText() { return box("text", "새 안내", "", "list"); }
  function newQr() { return box("qr", "", OLD.qr_text, "center"); }

  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pageUrl() { return location.origin + location.pathname.replace(/(index|admin)\.html$/, ""); }
  function line(t) {
    var warn = /^!/.test(t); if (warn) t = t.slice(1);
    var h = esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    var u = pageUrl();
    h = h.replace(/\{주소\}/g, '<a href="' + esc(u) + '">' + esc(u.replace(/^https?:\/\//, "").replace(/\/$/, "")) + "</a>");
    return warn ? '<span class="warn">' + h + "</span>" : h;
  }
  function items(text) {
    return String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map(function (s) { return s.replace(/^\n+|\n+$/g, ""); })
      .filter(function (s) { return s.trim(); });
  }
  function itemHtml(it) { return it.split("\n").map(line).join("<br>"); }

  function boxHtml(b) {
    var sc = Math.max(50, Math.min(200, +b.scale || 100)) / 100;
    var h = '<section class="info-box st-' + esc(b.style || "list") + (b.type === "qr" ? " qr-box" : "") + '" style="--box-scale:' + sc + '">';
    if (b.title) h += "<h2>" + esc(b.title) + "</h2>";
    if (b.type === "qr") {
      h += b.image ? '<img class="qr-img" src="' + esc(b.image) + '" alt="QR코드">' : '<div class="qr" data-qr aria-label="이 페이지 주소 QR코드"></div>';
    }
    var its = items(b.body);
    if (its.length) h += '<ul class="items">' + its.map(function (it) { return "<li>" + itemHtml(it) + "</li>"; }).join("") + "</ul>";
    return h + "</section>";
  }
  function render(boxes, opts) {
    opts = opts || {};
    return (boxes || []).filter(function (b) { return opts.showHidden || !b.hidden; }).map(boxHtml).join("");
  }
  // 자동 QR (이미지를 올리지 않은 QR 상자)
  function drawQr(root) {
    if (!window.QRCode) return;
    root.querySelectorAll("[data-qr]").forEach(function (el) {
      el.textContent = "";
      new window.QRCode(el, { text: pageUrl(), width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
      el.removeAttribute("title");
    });
  }
  window.SiteContent = { STYLES: STYLES, defaults: defaults, fromRows: fromRows, newText: newText, newQr: newQr, render: render, drawQr: drawQr };
})();
