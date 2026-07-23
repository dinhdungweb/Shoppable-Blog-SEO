import { describe, expect, it } from "vitest";
import {
  buildFaqSection,
  extractFaqSection,
  extractFaqSectionHtml,
  removeFaqSection,
  upsertFaqSection,
} from "./faq-content";

describe("FAQ content", () => {
  it("builds visible semantic FAQ HTML and escapes user-editable text", () => {
    const html = buildFaqSection("FAQ & help", [{
      id: "one",
      question: 'Can I use "silver" & gold?',
      answer: 'Use a soft cloth & avoid "strong" chemicals.',
    }]);
    expect(html).toContain('<section id="sbs-faq"');
    expect(html).toContain("<details");
    expect(html).toContain("FAQ &amp; help");
    expect(html).toContain("Can I use &quot;silver&quot; &amp; gold?");
    expect(html).not.toContain('Can I use "silver"');
  });

  it("replaces an existing FAQ section without changing the article around it", () => {
    const original = '<p>Before</p><section id="sbs-faq"><h2>Old</h2><details><summary>Old?</summary><p>Old answer.</p></details></section><p>After</p>';
    const updated = upsertFaqSection(original, "Questions", [{
      id: "new",
      question: "What is new?",
      answer: "This answer is supported by the article.",
    }]);
    expect(updated).toContain("<p>Before</p>");
    expect(updated).toContain("<p>After</p>");
    expect(updated.match(/id="sbs-faq"/g)).toHaveLength(1);
    expect(updated).not.toContain("Old answer");
  });

  it("extracts and removes the exact FAQ section", () => {
    const body = upsertFaqSection("<p>Article body.</p>", "Câu hỏi thường gặp", [
      { id: "one", question: "Vệ sinh thế nào?", answer: "Dùng khăn mềm và thao tác nhẹ nhàng." },
      { id: "two", question: "Cần tránh điều gì?", answer: "Tránh hóa chất mạnh theo hướng dẫn trong bài." },
    ]);
    expect(extractFaqSectionHtml(body)).toContain('id="sbs-faq"');
    expect(extractFaqSection(body)).toEqual({
      sectionTitle: "Câu hỏi thường gặp",
      items: [
        { id: "faq-1", question: "Vệ sinh thế nào?", answer: "Dùng khăn mềm và thao tác nhẹ nhàng." },
        { id: "faq-2", question: "Cần tránh điều gì?", answer: "Tránh hóa chất mạnh theo hướng dẫn trong bài." },
      ],
    });
    expect(removeFaqSection(body)).toBe("<p>Article body.</p>");
  });
});
