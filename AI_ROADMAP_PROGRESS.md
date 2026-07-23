# AI roadmap và tiến độ triển khai

> Cập nhật lần cuối: 2026-07-23  
> Đối chiếu với nhánh `main` tại `796c315` và các phần AI Internal Link Copilot, AI Content Brief đang hoàn thiện trong worktree  
> Mục đích: lưu lại các đề xuất AI đã trao đổi, trạng thái thực tế trong mã nguồn và thứ tự nên làm tiếp.

Danh sách dưới đây được dựng lại từ các đề xuất trong cuộc trao đổi hiện tại; tên hạng mục được chuẩn hóa để dùng lâu dài làm roadmap kỹ thuật.

## 1. Quy ước trạng thái

- **Hoàn thành**: đã có backend, giao diện sử dụng được, kiểm tra đầu ra, luồng review trước khi áp dụng và test phù hợp.
- **Một phần**: đã có nền tảng hoặc phiên bản theo luật, nhưng chưa đạt phạm vi AI Copilot đầy đủ đã đề xuất.
- **Chưa làm**: chưa có luồng chức năng tương ứng trong ứng dụng.

## 2. Tóm tắt tiến độ

Roadmap AI chính gồm 8 hạng mục:

- **6/8 hoàn thành đầy đủ**.
- **1/8 hoàn thành một phần**.
- **1/8 chưa làm**.

Các nền tảng hỗ trợ đã hoàn thành thêm:

- Kết nối 9Router theo chuẩn OpenAI-compatible API.
- Hỗ trợ model reasoning như `codex/gpt-5.5` với `reasoning_effort` hợp lệ.
- AI Bulk SEO cho meta title, meta description và alt ảnh đại diện.
- Content Decay Monitor và Google Search Console làm nguồn dữ liệu cho Content Refresh.

## 3. Roadmap gốc và trạng thái hiện tại

| # | Hạng mục đã đề xuất | Trạng thái | Tiến độ thực tế | Bằng chứng chính |
|---|---|---|---|---|
| 1 | AI Writing Assistant | **Hoàn thành** | Tạo bài mới, cải thiện, mở rộng hoặc rút gọn; dùng title, keyword, excerpt và chỉ dẫn; giữ product block; áp dụng vào draft | Commit `51393e0`; `app/ai-blog.server.ts`; editor bài viết |
| 2 | AI Product Placement | **Hoàn thành** | Xếp hạng catalog thật, đề xuất sản phẩm phù hợp, giải thích và vị trí chèn; merchant chọn trước khi thêm | Commit `47c3a2e`; `app/ai-product-placement.server.ts` |
| 3 | SEO Fix Copilot | **Hoàn thành** | Sửa từng lỗi hoặc tất cả; giải thích; preview trước/sau; chọn field; Apply/Undo; lỗi cần dữ liệu thật chuyển thành manual action | Commit `02beded`; `app/ai-seo-fix.server.ts` |
| 4 | AI Internal Link Copilot | **Hoàn thành** | Lọc ứng viên deterministic trước khi gửi 9Router; AI đánh giá ngữ nghĩa và ích lợi cho reader, đề xuất nhiều anchor khớp chính xác ngữ cảnh, cảnh báo cannibalization/anchor risk; preview Before/After; chọn nhiều, Apply batch và Undo; URL đích luôn được xác minh lại từ Shopify | `app/ai-internal-linking.server.ts`; `app/internal-linking.ts`; `app/routes/app.internal-links.tsx`; `InternalLinkChange` |
| 5 | AI Content Refresh Copilot | **Hoàn thành** | Dùng Content Decay và query thật từ Search Console; chọn signal/query; sửa title, body, excerpt và metadata; preview, chọn field, Apply/Undo; giữ link, ảnh, alt, TOC và product block | Commit `2321487`; `app/ai-content-refresh.server.ts`; `app/content-refresh-context.ts` |
| 6 | AI Content Brief & Keyword Cluster | **Hoàn thành** | Workspace tạo và lưu brief từ Shopify + Search Console; search intent, audience, objective, angle, keyword cluster, entity, H2/H3, câu hỏi, internal link, product placement và cannibalization; tái tạo từng phần; tạo draft điền sẵn trong editor | `app/ai-content-brief.server.ts`; `app/content-brief-context.ts`; `app/routes/app.content-briefs.tsx`; `ContentBrief` |
| 7 | AI Image SEO hàng loạt | **Một phần** | Đã có audit Image SEO nâng cao, AI bulk alt cho ảnh đại diện và SEO Fix cho alt trong từng bài. Chưa có workspace AI hàng loạt cho toàn bộ inline image, gom theo bài, preview/apply/undo theo ảnh | `app/routes/app.blogs.bulk_edit.tsx`; `app/seo-audit.ts`; commit `2d1d584`; các commit `002e1e2`, `9771266` |
| 8 | AI FAQ + Schema Generator | **Chưa làm** | Hiện có BlogPosting, BreadcrumbList và schema điều hướng/TOC, nhưng chưa có AI sinh FAQ từ nội dung, review câu hỏi/câu trả lời và xuất FAQPage JSON-LD | `extensions/shoppable-blog-widget/blocks/sbs-seo-schema.liquid`; chưa có AI FAQ service |

## 4. Các hạng mục đã hoàn thành chi tiết

### 4.1. Hạ tầng 9Router

Trạng thái: **Hoàn thành**.

- Cấu hình qua `NINE_ROUTER_BASE_URL`, `NINE_ROUTER_API_KEY` và `NINE_ROUTER_MODEL`.
- Dùng endpoint `/chat/completions` theo định dạng OpenAI-compatible.
- Model reasoning không nhận `temperature`; hệ thống dùng `reasoning_effort` mặc định là `low`.
- Đã sửa trường hợp `minimal` không được GPT-5.5 hỗ trợ.
- Không ghi API key vào mã nguồn hoặc file roadmap này.

Bằng chứng: `app/nine-router.server.ts`, commit `6dc0150`.

### 4.2. AI Bulk SEO metadata

Trạng thái: **Hoàn thành như một công cụ nền tảng**, không tính riêng trong 8 Copilot chính.

- Sinh meta title, meta description và alt ảnh đại diện cho nhiều bài.
- Cho sửa kết quả trước khi Apply.
- Có preview thay đổi và lịch sử Undo.
- Giới hạn độ dài và dùng dữ liệu bài thật.

Bằng chứng: commit `2d1d584`, `app/ai-seo.server.ts`, `app/routes/app.blogs.bulk_edit.tsx`.

### 4.3. AI Writing Assistant

Trạng thái: **Hoàn thành**.

Đã có:

- `draft`: tạo bản nháp mới.
- `improve`: cải thiện bài hiện tại.
- `expand`: mở rộng bằng nội dung hữu ích.
- `shorten`: rút gọn nhưng giữ ý chính.
- Sinh kèm excerpt, meta title và meta description.
- Không tự lưu hoặc xuất bản Shopify.

Giới hạn an toàn:

- Không tự bịa sản phẩm, giá, số liệu, testimonial, guarantee hoặc link.
- Không cho script/iframe/markup nguy hiểm.
- Giữ nguyên marker `[[SBS_PRODUCTS...]]`.

### 4.4. AI Product Placement

Trạng thái: **Hoàn thành**.

Đã có:

- Chỉ dùng catalog Shopify thật được server cung cấp.
- Xếp hạng sơ bộ sản phẩm liên quan trước khi gửi AI.
- AI trả về lý do và gợi ý vị trí chèn.
- Merchant chọn sản phẩm trước khi thêm vào product block.
- Không cho AI tạo product ID hoặc sản phẩm không tồn tại.

### 4.5. SEO Fix Copilot

Trạng thái: **Hoàn thành**.

Đã có:

- Nút **Fix with AI** cho từng issue và **Fix all with AI**.
- Sửa body, excerpt, meta title, meta description và featured image alt.
- Preview Before/After và checkbox chọn từng field.
- Giải thích issue nào/query nào dẫn tới thay đổi.
- Apply vào draft, Undo được và không tự save Shopify.
- Chống ghi đè nếu draft bị sửa trong lúc AI đang chạy.

Việc AI không được tự làm:

- Bịa external source, kinh nghiệm, author credential hoặc sản phẩm.
- Tự đổi URL đã publish.
- Tự chọn ảnh thay thế, kích thước ảnh hoặc nguồn ảnh.
- Làm mất link, ảnh, bảng, TOC hoặc product block.

### 4.6. AI Content Refresh Copilot

Trạng thái: **Hoàn thành**.

Đã có:

- Mở trực tiếp từ hàng issue trong Content Decay bằng nút **AI refresh**.
- Thẻ AI Content Refresh Copilot trong editor bài viết.
- Chọn từng Content Decay signal và tối đa các query Search Console liên quan URL bài.
- Hiển thị clicks, impressions, CTR, position và số liệu kỳ trước.
- AI có thể đề xuất title, body, excerpt, meta title và meta description.
- Preview Before/After, chọn từng field, Apply và Undo.
- Chỉ cập nhật draft; Save Shopify vẫn là thao tác riêng.

Giới hạn an toàn:

- Không suy diễn Search Console là nguyên nhân chắc chắn hoặc bảo đảm tăng ranking/CTR.
- Link hỏng, sản phẩm không khả dụng và năm cũ là manual verification.
- Bài stale luôn có checklist xác minh fact, ngày, ảnh, link và sản phẩm.
- Server bắt buộc giữ nguyên href, image src, image alt, product marker và TOC marker.

Lưu ý thứ tự: hạng mục này được triển khai trước AI Internal Link Copilot theo lựa chọn gần nhất của người dùng, dù Internal Link Copilot đứng trước trong roadmap ban đầu.

## 5. Chi tiết hạng mục vừa hoàn thành và phần còn thiếu

### 5.1. AI Internal Link Copilot

Trạng thái: **Hoàn thành**.

Đã có:

- Quét internal link, orphan article, broken destination, repeated anchor và topic cluster bằng bộ lọc deterministic.
- Chỉ gửi tối đa các cặp source/target đã được server lấy từ đúng shop sang 9Router.
- AI đánh giá quan hệ ngữ nghĩa, lợi ích cho reader và loại bỏ cặp yếu dù có keyword overlap.
- Đề xuất tối đa ba anchor tự nhiên; mỗi anchor bắt buộc khớp chính xác đoạn text chưa gắn link trong source article.
- Cảnh báo khả năng keyword cannibalization, anchor bị dùng quá nhiều hoặc anchor mơ hồ.
- Hiển thị topic score, AI relevance, giải thích và preview Before/After.
- Cho chọn từng link hoặc chọn nhiều link để review và Apply theo batch.
- Trước khi ghi, server tải lại source/target từ Shopify, dựng lại URL đích và bỏ qua link trùng hoặc anchor không còn khớp.
- Lưu lịch sử theo từng article và Undo chỉ khi body hiện tại vẫn đúng phiên bản Copilot đã ghi, tránh đè nội dung mới.
- Có test cho allowlist cặp bài, anchor chính xác, URL server-side, preview và output AI không hợp lệ.

### 5.2. AI Content Brief & Keyword Cluster

Trạng thái: **Hoàn thành**.

Đã có:

- Workspace riêng để tạo, xem lại, xóa và lưu tối đa lịch sử brief gần nhất theo từng shop.
- Đầu vào gồm topic/title, seed keyword, audience, objective và bài Shopify tùy chọn làm context.
- Lọc trước tối đa các bài, sản phẩm active và query Search Console liên quan rồi mới gửi 9Router.
- Brief gồm search intent, audience, objective, content angle, primary/secondary keyword, entity/topic, outline H2/H3 và câu hỏi cần trả lời.
- Gợi ý internal link và product placement chỉ được giữ khi ID, title và URL khớp tài nguyên Shopify do server cung cấp.
- Query, clicks, impressions, CTR và position do AI trả lại đều được thay bằng số liệu Search Console thật từ allowlist server.
- Phát hiện bài có khả năng cạnh tranh, giải thích rủi ro và gợi ý differentiate, consolidate, update hoặc proceed.
- Cho tái tạo độc lập strategy, keyword cluster, outline, questions, internal links, product placements và cannibalization review.
- Tạo bài hoàn chỉnh từ brief rồi mở Blog Editor mới với title, handle, body, excerpt, metadata và focus keywords điền sẵn.
- Draft chỉ nằm trong editor; merchant vẫn phải review và Save để ghi lên Shopify, không có auto-publish.
- Khi Search Console chưa kết nối, workspace thông báo rõ và vẫn tạo brief từ dữ liệu Shopify mà không bịa query.
- Có test cho context ranking, query competition, allowlist article/product/query và brief thiếu outline.

### 5.3. AI Image SEO hàng loạt

Nền tảng hiện có:

- Audit missing alt, alt stuffing, decorative alt, dimensions, filename, resolution và crawlability.
- AI bulk alt cho featured image.
- SEO Fix Copilot có thể sửa inline alt trong một bài.

Phần còn thiếu:

- Workspace liệt kê toàn bộ ảnh inline bị lỗi trên nhiều bài.
- Thumbnail + article + URL + alt hiện tại + lỗi cụ thể.
- AI alt theo ngữ cảnh đoạn chứa ảnh, không chỉ theo title bài.
- Chọn từng ảnh/bài, preview và Apply batch.
- Undo theo batch.
- Không sửa decorative image thành alt mô tả.
- Không đổi `src`, filename, width/height hoặc ảnh thật nếu merchant chưa chọn asset thay thế.

### 5.4. AI FAQ + Schema Generator

Trạng thái hiện tại: **Chưa làm**.

Phạm vi đề xuất:

- Trích xuất câu hỏi thực sự được bài trả lời hoặc gợi ý câu hỏi dựa trên Search Console query.
- Sinh câu trả lời chỉ từ nội dung/fact đã có trong bài.
- Merchant chọn, sửa và sắp xếp FAQ.
- Chèn FAQ HTML vào draft nếu được chọn.
- Sinh `FAQPage` JSON-LD khớp chính xác nội dung FAQ hiển thị.
- Không tạo FAQ schema nếu câu hỏi/câu trả lời không xuất hiện trên trang.
- Preview, Apply/Undo và test JSON-LD hợp lệ.

## 6. Thứ tự triển khai đề xuất từ thời điểm hiện tại

1. **AI Image SEO hàng loạt** — mở rộng AI bulk hiện tại từ featured image sang toàn bộ inline image.
2. **AI FAQ + Schema Generator** — tận dụng brief/query pipeline đã hoàn thành để giảm FAQ mỏng hoặc bịa nội dung.

Không cần làm lại AI Content Refresh; hạng mục đó đã hoàn thành trước thứ tự.

## 7. Tiêu chuẩn chung cho mọi AI Copilot tiếp theo

Mỗi tính năng chỉ được đánh dấu **Hoàn thành** khi có đủ:

- Dữ liệu đầu vào được giới hạn theo đúng shop và tài nguyên thật.
- AI trả structured JSON được server kiểm tra.
- Không tin ID, URL, product hoặc source do AI tự tạo.
- Preview Before/After.
- Cho chọn từng thay đổi.
- Apply vào draft hoặc trạng thái chờ duyệt, không auto-publish.
- Undo hoặc lịch sử thay đổi phù hợp.
- Chống ghi đè khi dữ liệu đã đổi trong lúc AI chạy.
- Giới hạn kích thước, timeout và thông báo lỗi 9Router dễ hiểu.
- Test success path, invalid JSON, unsafe output và bảo toàn marker/link/asset.
- TypeScript, ESLint, full test suite và production build đều pass.

## 8. Ghi chú kỹ thuật phát hiện khi rà soát

Các mục dưới đây không làm thay đổi trạng thái chức năng chính, nhưng nên được xử lý trong một lượt hardening:

1. **AI Writing Assistant** đã bảo toàn danh sách href, nhưng vẫn cần bổ sung phép so sánh image src trước và sau cho chế độ improve/expand/shorten trên bài có inline image.
2. **SEO Fix Copilot** bắt buộc giữ link, ảnh và SBS marker; tuy nhiên việc giữ nguyên số lượng/cấu trúc table hiện mới được yêu cầu trong prompt và hỗ trợ bởi sanitizer, chưa có phép so sánh table ở server.
3. **Content Refresh Copilot** bắt buộc giữ href, image src, image alt và SBS marker; cấu trúc table cũng mới được bảo vệ bằng prompt/sanitizer, chưa được đối chiếu chính xác ở server.
4. Cả ba điểm trên nên có thêm regression test trước khi mở các thao tác Apply hàng loạt lên body HTML.

Hạng mục hardening này nên được xử lý trước khi mở rộng thêm các thao tác AI batch lên body HTML.

## 9. Kết quả kiểm tra gần nhất

Sau khi hoàn thành AI Internal Link Copilot và AI Content Brief & Keyword Cluster trong worktree ngày 2026-07-23:

- `npx prisma validate`: pass.
- `npm test`: **101/101 test pass**, 25 test files.
- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm run build`: pass.

Các cảnh báo build còn thấy là cảnh báo có sẵn từ CSS/Remix dependency, không phải lỗi build của các Copilot AI.

## 10. Nhật ký cập nhật roadmap

- **2026-07-22**: tạo file tổng hợp; xác nhận Writing Assistant, Product Placement, SEO Fix và Content Refresh đã hoàn thành.
- **2026-07-22**: xác nhận Internal Link Copilot, Content Brief/Keyword Cluster và Image SEO Bulk mới hoàn thành một phần.
- **2026-07-23**: hoàn thành AI Internal Link Copilot với AI review, preview, batch apply và guarded Undo.
- **2026-07-23**: hoàn thành AI Content Brief & Keyword Cluster, lưu brief theo shop, tái tạo từng phần và chuyển thành draft điền sẵn trong Blog Editor.
- **2026-07-22**: xác nhận AI FAQ + Schema Generator chưa triển khai.
- **2026-07-23**: hoàn thiện AI Internal Link Copilot với semantic review, exact-anchor validation, risk warnings, Before/After preview, batch Apply và guarded Undo.
- Lần cập nhật tiếp theo: sau khi triển khai AI Content Brief & Keyword Cluster, đổi trạng thái mục 6 và bổ sung commit/test tương ứng.
