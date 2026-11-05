(function () {
  "use strict";
  // 이 예약표 주소의 QR코드
  var url = location.origin + location.pathname.replace(/index\.html$/, "");
  var a = document.getElementById("qr-link");
  if (a) { a.href = url; a.textContent = url.replace(/^https?:\/\//, "").replace(/\/$/, ""); }
  var box = document.getElementById("qr");
  if (box && window.QRCode) {
    new window.QRCode(box, { text: url, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
    box.removeAttribute("title");
  }
})();
