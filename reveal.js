/* ============================================================
   Lumen — Scroll Reveal (card grids only)
   Self-contained IIFE. No dependencies.

   Scope: `.step-card` and `.feature-card` grids only. Fades + lifts each
   card in on first entry to the viewport, staggered 60ms per card in DOM
   order. Triggers once per element. Respects prefers-reduced-motion by
   skipping the observer entirely and leaving cards at their resting state.
============================================================ */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var STAGGER_MS = 60;

  var grids = document.querySelectorAll(".steps, .features-grid");
  if (!grids.length) return;

  if (prefersReduced || !window.IntersectionObserver) {
    // No animation — cards already render at resting opacity/position.
    return;
  }

  var observer = new IntersectionObserver(function (entries, obs) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var card = entry.target;
      card.classList.add("is-revealed");

      // Once the reveal transition finishes, drop the stagger delay so
      // later interactions (e.g. hover) aren't delayed too.
      card.addEventListener("transitionend", function handler(e) {
        if (e.propertyName !== "opacity") return;
        card.style.transitionDelay = "";
        card.removeEventListener("transitionend", handler);
      });

      obs.unobserve(card);
    });
  }, { threshold: 0.15 });

  grids.forEach(function (grid) {
    Array.prototype.slice.call(grid.children).forEach(function (card, i) {
      if (!card.classList.contains("step-card") && !card.classList.contains("feature-card")) return;
      card.classList.add("reveal-init");
      card.style.transitionDelay = (i * STAGGER_MS) + "ms";
      observer.observe(card);
    });
  });

}());
