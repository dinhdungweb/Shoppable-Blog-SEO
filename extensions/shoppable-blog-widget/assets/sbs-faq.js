"use strict";

(function () {
  "use strict";

  if (window.__sbsFaqSchemaLoaded) return;
  window.__sbsFaqSchemaLoaded = true;

  const init = () => {
    const section = document.getElementById("sbs-faq");
    const existing = document.getElementById("sbs-faq-schema");
    if (!section || !isVisible(section)) {
      if (existing) existing.remove();
      return;
    }

    const mainEntity = Array.from(section.querySelectorAll("details")).flatMap((item) => {
      const question = cleanText(item.querySelector("summary")?.textContent);
      const answer = cleanText(item.querySelector(".sbs-faq__answer")?.textContent || item.querySelector("p")?.textContent);
      if (!question || !answer) return [];
      return [{
        "@type": "Question",
        name: question,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer,
        },
      }];
    });

    if (!mainEntity.length) {
      if (existing) existing.remove();
      return;
    }

    const script = existing || document.createElement("script");
    script.id = "sbs-faq-schema";
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${window.location.href.split("#")[0]}#faq`,
      mainEntity,
    });
    if (!existing) document.head.appendChild(script);
  };

  function isVisible(element) {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
