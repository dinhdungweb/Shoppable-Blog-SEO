import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAiFaq } from "./ai-faq.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NINE_ROUTER_BASE_URL;
  delete process.env.NINE_ROUTER_API_KEY;
  delete process.env.NINE_ROUTER_MODEL;
});

describe("AI FAQ", () => {
  it("keeps only FAQs backed by an exact article excerpt", async () => {
    configure();
    stubResult({
      sectionTitle: "Câu hỏi thường gặp",
      summary: "FAQ dựa trên nội dung bài.",
      items: [
        {
          id: "cleaning",
          question: "Nên vệ sinh nhẫn bằng cách nào?",
          answer: "Hãy dùng khăn mềm để lau nhẫn nhẹ nhàng.",
          evidence: "Dùng khăn mềm để lau nhẫn nhẹ nhàng và tránh chà xát mạnh.",
          query: "cách vệ sinh nhẫn bạc",
        },
        {
          id: "invented",
          question: "Có bảo hành trọn đời không?",
          answer: "Có bảo hành trọn đời.",
          evidence: "Bảo hành trọn đời.",
          query: "",
        },
      ],
    });
    const result = await generateAiFaq({
      title: "Cách vệ sinh nhẫn bạc",
      body: articleBody(),
      queries: [{ query: "cách vệ sinh nhẫn bạc", impressions: 100 }],
    });
    expect(result.sectionTitle).toBe("Câu hỏi thường gặp");
    expect(result.items).toEqual([expect.objectContaining({
      id: "cleaning",
      query: "cách vệ sinh nhẫn bạc",
    })]);
  });

  it("rejects an answer that invents a number", async () => {
    configure();
    stubResult({
      sectionTitle: "FAQ",
      summary: "",
      items: [{
        id: "number",
        question: "Nên ngâm nhẫn bao lâu?",
        answer: "Ngâm nhẫn trong 30 phút.",
        evidence: "Dùng khăn mềm để lau nhẫn nhẹ nhàng và tránh chà xát mạnh.",
        query: "",
      }],
    });
    await expect(generateAiFaq({ title: "Nhẫn bạc", body: articleBody() }))
      .rejects.toThrow("no safe FAQ");
  });

  it("falls back through JSON modes and extracts JSON from commentary", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "json_schema unsupported" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "response_format unsupported" } }), { status: 400 }))
      .mockResolvedValueOnce(aiResponse(`Result:\n${JSON.stringify({
        section_title: "Câu hỏi thường gặp",
        explanation: "Dựa trên bài.",
        faqs: [{
          id: "one",
          q: "Nên dùng loại khăn nào?",
          a: "Nên dùng khăn mềm để lau nhẫn.",
          source_excerpt: "Dùng khăn mềm để lau nhẫn nhẹ nhàng và tránh chà xát mạnh.",
          source_query: "",
        }],
      })}\nDone.`));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiFaq({ title: "Nhẫn bạc", body: articleBody() });
    expect(result.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const thirdRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(thirdRequest.response_format).toBeUndefined();
  });

  it("does not use an existing generated FAQ as source evidence", async () => {
    configure();
    stubResult({
      sectionTitle: "FAQ",
      summary: "",
      items: [{
        id: "old",
        question: "Có bảo hành không?",
        answer: "Có bảo hành trọn đời.",
        evidence: "Có bảo hành trọn đời.",
        query: "",
      }],
    });
    const body = `${articleBody()}<section id="sbs-faq"><h2>FAQ</h2><details><summary>Có bảo hành không?</summary><p>Có bảo hành trọn đời.</p></details></section>`;
    await expect(generateAiFaq({ title: "Nhẫn bạc", body })).rejects.toThrow("no safe FAQ");
  });
});

function articleBody() {
  return "<p>Dùng khăn mềm để lau nhẫn nhẹ nhàng và tránh chà xát mạnh. Không sử dụng hóa chất tẩy rửa mạnh vì có thể ảnh hưởng đến bề mặt trang sức.</p>";
}

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20127/v1";
  process.env.NINE_ROUTER_API_KEY = "test";
  process.env.NINE_ROUTER_MODEL = "gc/test";
}

function stubResult(content: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => aiResponse(JSON.stringify(content))));
}

function aiResponse(content: string) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), { status: 200 });
}
