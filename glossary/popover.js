(function () {
  var terms = document.querySelectorAll(".term");
  // Keep the explanation inside the viewport (16px gutter), near the right edge too.
  function place(t) {
    var tip = t.querySelector(".tip");
    // Hidden tips are display:none (so they never widen the page): show it to measure it.
    tip.style.left = "0px";
    tip.style.display = "block";
    var r = tip.getBoundingClientRect(), dx = 0, max = document.documentElement.clientWidth - 16;
    tip.style.display = "";
    if (r.right > max) dx = max - r.right;
    if (r.left + dx < 16) dx = 16 - r.left;
    tip.style.left = dx + "px";
  }
  function closeAll(except) {
    terms.forEach(function (t) { if (t !== except) t.classList.remove("open"); });
  }
  terms.forEach(function (t) {
    t.addEventListener("mouseenter", function () { place(t); });
    t.addEventListener("focus", function () { place(t); });
    // Tap (touch) toggles; hover and keyboard focus are pure CSS.
    t.addEventListener("click", function (e) {
      e.stopPropagation();
      closeAll(t);
      place(t);
      t.classList.toggle("open");
    });
  });
  document.addEventListener("click", function () { closeAll(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    closeAll();
    var a = document.activeElement;
    if (a && a.classList.contains("term")) a.blur();
  });
})();
