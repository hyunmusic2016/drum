// 예약표 오른쪽 안내 칸: 기본 문구와 그리는 방법 (index.html, admin.html 공용)
// 문구 규칙: 빈 줄로 항목 구분, 항목 안의 줄바꿈은 그대로, **굵게**, 줄 맨 앞 ! = 빨간 굵은 글씨, {주소} = 이 페이지 주소
(function () {
  "use strict";
  var DEFAULTS = {
    usage_title: "이용안내",
    usage: "당일 예약과 방문 예약만 가능합니다.\n\n하루에 예약할 수 있는 시간은 총 2시간입니다.\n\n예약 시간 이후 10분간 입실하지 않을 시 연습실 사용은 취소되며, 연습실 내 연습하는 사람이 없으면 사용은 취소됩니다.\n\n본 페이지는 어쿠스틱 드럼 연습실 예약페이지 입니다. 전자 드럼 연습실은 상시 이용 가능합니다.\n\n!해당 PC에서 연습실 예약 외 다른 작업은 불가합니다.",
    caution_title: "유의사항",
    caution: "연습실내 물 이외 음식물 반입금지\n(드럼 카페트 오염시 변상)\n\n방음문 살살 닫기\n(문 고장시 수리비 청구)",
    howto_title: "예약방법",
    howto: "① 예약을 원하시는 시간대에 본인의 이름을 기입하시면 됩니다.\n**· 처음 예약은 최대 1시간 가능하며, 1시간 연습 후 다음 예약자가 없으면 30분 단위로 1시간 연장 가능합니다.**\n\n② 30분만 예약이 가능합니다.\n\n③ **'수업'**, **'종료'** 란은 수강생이 임의로 수정 및 삭제가 불가능 합니다.",
    qr_text: "(해당페이지 URL QR코드)\n{주소}\n\n본 예약페이지는 외부에서 열람 가능합니다.\n(예약 불가, 열람만 가능)\n\n학원 오시기 전 연습실 예약 현황을 확인 해보세요!",
    qr_image: ""
  };
  var KEYS = Object.keys(DEFAULTS);

  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pageUrl() { return location.origin + location.pathname.replace(/(index|admin)\.html$/, ""); }
  // 한 줄 -> HTML (굵게, 빨강, {주소})
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

  // 안내 칸 전체 HTML
  function render(c) {
    c = Object.assign({}, DEFAULTS, c || {});
    function list(cls, text) {
      return '<ul class="' + cls + '">' + items(text).map(function (it) { return "<li>" + itemHtml(it) + "</li>"; }).join("") + "</ul>";
    }
    var qrText = items(c.qr_text).map(function (it) { return "<p>" + itemHtml(it) + "</p>"; }).join("");
    var qr = c.qr_image
      ? '<img class="qr-img" src="' + esc(c.qr_image) + '" alt="QR코드">'
      : '<div class="qr" id="qr" aria-label="이 페이지 주소 QR코드"></div>';
    return '<section class="info-box"><h2>' + esc(c.usage_title) + "</h2>" + list("usage", c.usage) + "</section>" +
      '<section class="info-box"><h2>' + esc(c.caution_title) + "</h2>" + list("caution", c.caution) + "</section>" +
      '<section class="info-box"><h2>' + esc(c.howto_title) + "</h2>" + list("howto", c.howto) + "</section>" +
      '<section class="info-box qr-box">' + qr + qrText + "</section>";
  }
  // 자동 QR (이미지를 올리지 않았을 때)
  function drawQr(root) {
    var box = root.querySelector("#qr");
    if (!box || !window.QRCode) return;
    box.textContent = "";
    new window.QRCode(box, { text: pageUrl(), width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
    box.removeAttribute("title");
  }
  window.SiteContent = { DEFAULTS: DEFAULTS, KEYS: KEYS, render: render, drawQr: drawQr };
})();
