# AI roadmap và tiến độ triển khai

> Cập nhật lần cuối: 2026-07-23
> Đối chiếu với mã nguồn ngày 2026-07-23, bao gồm AI FAQ + Schema Generator trong worktree hiện tại
> Mục đích: lưu lại các đề xuất AI đã trao đổi, trạng thái thực tế trong mã nguồn và thứ tự nên làm tiếp.

Danh sách dưới đây được dựng lại từ các đề xuất trong cuộc trao đổi hiện tại; tên hạng mục được chuẩn hóa để dùng lâu dài làm roadmap kỹ thuật.

## 1. Quy ước trạng thái

- **Hoàn thành**: đã có backend, giao diện sử dụng được, kiểm tra đầu ra, luồng review trước khi áp dụng và test phù hợp.
- **Một phần**: đã có nền tảng hoặc phiên bản theo luật, nhưng chưa đạt phạm vi AI Copilot đầy đủ đã đề xuất.
- **Chưa làm**: chưa có luồng chức năng tương ứng trong ứng dụng.

## 2. Tóm tắt tiến độ

Roadmap AI chính gồm 8 hạng mục:

- **8/8 hoàn thành đầy đủ**.
- **0/8 hoàn thành một phần**.
- **0/8 chưa làm**.

Các nền tảng hỗ trợ đã hoàn thành thêm:

- Kết nối 9Router theo chuẩn OpenAI-compatible API.
- Hỗ trợ model reasoning như `codex/gpt-5.5` với `reasoning_effort` hợp lệ.
- Fallback nhiều tầng cho model không hỗ trợ `json_schema`/`response_format`, kèm bộ trích xuất và kiểm tra JSON dùng chung.
- AI Bulk SEO cho meta title, meta description và alt ảnh đại diện.
- Content Decay Monitor và Google Search Console làm nguồn dữ liệu cho Content Refresh.
- Content Brief xác minh sản phẩm Shopify, chèn product block và liên kết sản phẩm tự động khi lưu bài.
- Quota AI theo tháng: Free có 10 lượt tạo thành công; Pro/Growth không giới hạn; server trừ lượt nguyên tử và hoàn lượt khi AI lỗi.

## 3. Roadmap gốc và trạng thái hiện tại

| # | Hạng mục đã đề xuất | Trạng thái | Tiến độ thực tế | Bằng chứng chính |
|---|---|---|---|---|
| 1 | AI Writing Assistant | **Hoàn thành** | Tạo bài mới, cải thiện, mở rộng hoặc rút gọn; dùng title, keyword, excerpt và chỉ dẫn; giữ product block; áp dụng vào draft | Commit `51393e0`; `app/ai-blog.server.ts`; editor bài viết |
| 2 | AI Product Placement | **Hoàn thành** | Xếp hạng catalog thật, đề xuất sản phẩm phù hợp, giải thích và vị trí chèn; merchant chọn trước khi thêm | Commit `47c3a2e`; `app/ai-product-placement.server.ts` |
| 3 | SEO Fix Copilot | **Hoàn thành** | Sửa từng lỗi hoặc tất cả; giải thích; preview trước/sau; chọn field; Apply/Undo; lỗi cần dữ liệu thật chuyển thành manual action | Commit `02beded`; `app/ai-seo-fix.server.ts` |
| 4 | AI Internal Link Copilot | **Hoàn thành** | Lọc ứng viên deterministic trước khi gửi 9Router; AI đánh giá ngữ nghĩa và ích lợi cho reader, đề xuất nhiều anchor khớp chính xác ngữ cảnh, cảnh báo cannibalization/anchor risk; preview Before/After; chọn nhiều, Apply batch và Undo; URL đích luôn được xác minh lại từ Shopify | `app/ai-internal-linking.server.ts`; `app/internal-linking.ts`; `app/routes/app.internal-links.tsx`; `InternalLinkChange` |
| 5 | AI Content Refresh Copilot | **Hoàn thành** | Dùng Content Decay và query thật từ Search Console; chọn signal/query; sửa title, body, excerpt và metadata; preview, chọn field, Apply/Undo; giữ link, ảnh, alt, TOC và product block | Commit `2321487`; `app/ai-content-refresh.server.ts`; `app/content-refresh-context.ts` |
| 6 | AI Content Brief & Keyword Cluster | **Hoàn thành** | Workspace tạo và lưu brief từ Shopify + Search Console; search intent, audience, objective, angle, keyword cluster, entity, H2/H3, câu hỏi, internal link, product placement và cannibalization; tái tạo từng phần; tạo draft điền sẵn; xác minh và tự liên kết sản phẩm vào block khi lưu bài | `app/ai-content-brief.server.ts`; `app/content-brief-context.ts`; `app/content-brief-products.ts`; `app/routes/app.content-briefs.tsx`; `ContentBrief` |
| 7 | AI Image SEO hàng loạt | **Hoàn thành** | Quét featured và inline images; AI alt theo ngữ cảnh; filter/select/edit/preview; Apply tối đa 100 thay đổi; lịch sử và guarded Undo theo batch; giữ nguyên src, dimensions và thuộc tính ngoài alt | `app/image-seo.ts`; `app/ai-image-seo.server.ts`; `app/routes/app.image-seo.tsx`; `ImageSeoChange` |
| 8 | AI FAQ + Schema Generator | **Hoàn thành** | Sinh FAQ chỉ từ bằng chứng có trong bài và query Search Console được xác minh; merchant chọn, sửa, xóa, sắp xếp, Apply/Undo trong draft; storefront xuất FAQ accordion và `FAQPage` JSON-LD từ đúng nội dung đang hiển thị | `app/ai-faq.server.ts`; `app/faq-content.ts`; Blog Editor; `extensions/shoppable-blog-widget/assets/sbs-faq.js` |

## 4. Các hạng mục đã hoàn thành chi tiết

### 4.1. Hạ tầng 9Router

Trạng thái: **Hoàn thành**.

- Cấu hình qua `NINE_ROUTER_BASE_URL`, `NINE_ROUTER_API_KEY` và `NINE_ROUTER_MODEL`.
- Dùng endpoint `/chat/completions` theo định dạng OpenAI-compatible.
- Model reasoning không nhận `temperature`; hệ thống dùng `reasoning_effort` mặc định là `low`.
- Đã sửa trường hợp `minimal` không được GPT-5.5 hỗ trợ.
- Không ghi API key vào mã nguồn hoặc file roadmap này.
- Gói Free được giới hạn 10 lượt AI thành công mỗi tháng UTC tại server; không thể vượt giới hạn bằng cách gọi action trực tiếp.
- Lượt đang xử lý được đặt chỗ nguyên tử để chống request đồng thời; lỗi provider hoặc output không hợp lệ sẽ tự hoàn lượt.
- Blog Editor hiển thị lượt còn lại và chuyển tới Pricing khi đã hết quota; Pro/Growth không giới hạn.

Bằng chứng: `app/nine-router.server.ts`, `app/ai-usage.server.ts`, `AiUsage`, commit `6dc0150`.

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
- Product placement trong brief chỉ dùng sản phẩm Shopify đã được server xác minh; ứng dụng tự tạo marker block riêng, không dùng tên sản phẩm làm shortcode.
- Tab Products của bài mới hiển thị đầy đủ ảnh, tên, giá và trạng thái **Ready on save** cho các sản phẩm đang chờ liên kết.
- Khi merchant lưu bài, các sản phẩm đã xác minh được ghi vào đúng article ID và đúng product block; không cần thêm lại thủ công.
- Draft chỉ nằm trong editor; merchant vẫn phải review và Save để ghi lên Shopify, không có auto-publish.
- Khi Search Console chưa kết nối, workspace thông báo rõ và vẫn tạo brief từ dữ liệu Shopify mà không bịa query.
- Có test cho context ranking, query competition, allowlist article/product/query và brief thiếu outline.

### 5.3. AI Image SEO hàng loạt

Trạng thái: **Hoàn thành**.

Đã có:

- Workspace Growth riêng quét tối đa 500 Shopify articles và thống kê toàn bộ featured/inline images.
- Phát hiện featured image thiếu alt, inline image thiếu thuộc tính alt, alt nhồi lặp từ và ảnh `role="presentation"`/`aria-hidden="true"` có alt mô tả.
- Không coi inline image có `alt=""` là lỗi nếu không đủ bằng chứng nó cần nội dung mô tả, tránh phá ảnh trang trí hợp lệ.
- Hiển thị thumbnail, article, loại/vị trí ảnh, URL rút gọn, lỗi, alt hiện tại và giải thích AI.
- Lọc theo loại lỗi, featured/inline, tìm theo article/URL/alt và phân trang.
- Cho chọn từng ảnh hoặc toàn trang; mỗi AI request xử lý tối đa 50 ảnh theo các batch nhỏ.
- AI dùng title, immediate surrounding text, alt hiện tại và filename có nghĩa; không được đoán màu, vật liệu, người, variant, giá, claim hoặc chi tiết thị giác không có trong input.
- Merchant sửa alt đề xuất, xem exact Before/After và Apply tối đa 100 thay đổi mỗi batch.
- Decorative image bắt buộc dùng `alt=""`; descriptive image không được để trống, quá 160 ký tự hoặc nhồi lặp.
- Trước Apply, server tải lại Shopify article và đối chiếu article ID, body hash, image index, src, alt và decorative state.
- Inline update chỉ thay thuộc tính `alt`; `src`, filename, width, height và mọi thuộc tính HTML khác được giữ nguyên.
- Lịch sử lưu theo batch; Undo chỉ chạy khi body/featured image vẫn đúng phiên bản Copilot đã ghi, và dừng nếu có nội dung mới cần bảo vệ.
- Apply/Undo nhiều bài có compensation rollback nếu một Shopify mutation hoặc thao tác lưu lịch sử thất bại.
- Có test cho scanner, surrounding context, missing/stuffed/decorative alt, invariant thuộc tính ảnh, stale body, allowlist AI ID và output AI không an toàn.

### 5.4. AI FAQ + Schema Generator

Trạng thái: **Hoàn thành**.

Đã có:

- Trích xuất câu hỏi và câu trả lời từ nội dung bài; mỗi kết quả AI phải kèm một đoạn bằng chứng liên tiếp có thật trong article HTML.
- Cho dùng query Search Console đã được server xác minh làm gợi ý câu hỏi, nhưng không coi query là bằng chứng cho câu trả lời.
- Loại câu trả lời không bám bằng chứng, câu hỏi trùng, query ngoài allowlist và số liệu không tồn tại trong bài.
- Fallback ba tầng cho model hỗ trợ `json_schema`, chỉ hỗ trợ JSON object hoặc không hỗ trợ `response_format`.
- Merchant chọn, sửa, xóa và sắp xếp FAQ trước khi áp dụng.
- Chèn một section FAQ semantic bằng `section`, `details` và `summary` vào draft; không tự lưu hoặc xuất bản Shopify.
- Refresh FAQ đã có, Remove và guarded Undo; dừng Apply nếu draft đã thay đổi trong lúc AI chạy.
- Storefront sinh `FAQPage` JSON-LD trực tiếp từ câu hỏi/câu trả lời đang hiển thị, nên schema luôn khớp nội dung người mua nhìn thấy.
- Không tạo schema khi FAQ bị ẩn, trống hoặc không có nội dung hợp lệ.
- Writing Assistant, SEO Fix và Content Refresh được bảo vệ để giữ nguyên section FAQ hiện có.
- Có test cho escaping/replace/remove HTML, bằng chứng, query allowlist, số liệu bịa, JSON fallback và bảo toàn FAQ qua các Copilot khác.

## 6. Thứ tự triển khai đề xuất từ thời điểm hiện tại

Toàn bộ 8 Copilot AI trong roadmap gốc đã hoàn thành. Bước tiếp theo nên là lượt **AI body HTML hardening** được liệt kê tại mục 8, trước khi thêm một Copilot mới hoặc mở rộng batch Apply trên nội dung bài.

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

Các hạng mục vận hành storefront đã hoàn thành:

- Đồng bộ Theme App Extension với App Proxy đang hoạt động tại `/apps/shoppable-blog-seo`.
- Widget sản phẩm tự ẩn khi proxy lỗi, thiếu cấu hình hoặc không có sản phẩm; thông tin kỹ thuật chỉ ghi trong DevTools Console, không hiển thị cho khách.
- Cần chạy `shopify app deploy --allow-updates` sau khi thay đổi Theme App Extension; chỉ Git push hoặc restart PM2 không cập nhật asset storefront.

## 9. Kết quả kiểm tra gần nhất

Sau khi hoàn thành AI FAQ + Schema Generator ngày 2026-07-23:

- `npx prisma validate`: pass.
- `npm test -- --run`: **142/142 test pass**, 31 test files.
- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm run build`: pass.
- `npx shopify app build`: pass.

Các cảnh báo build còn thấy là cảnh báo có sẵn từ CSS/Remix dependency, không phải lỗi build của các Copilot AI.

## 10. Nhật ký cập nhật roadmap

- **2026-07-22**: tạo file tổng hợp; xác nhận Writing Assistant, Product Placement, SEO Fix và Content Refresh đã hoàn thành.
- **2026-07-22**: xác nhận Internal Link Copilot, Content Brief/Keyword Cluster và Image SEO Bulk mới hoàn thành một phần.
- **2026-07-23**: hoàn thành AI Internal Link Copilot với AI review, preview, batch apply và guarded Undo.
- **2026-07-23**: hoàn thành AI Content Brief & Keyword Cluster, lưu brief theo shop, tái tạo từng phần và chuyển thành draft điền sẵn trong Blog Editor.
- **2026-07-23**: hoàn thành AI Image SEO hàng loạt cho featured/inline images, AI review theo ngữ cảnh, preview, guarded Apply và Undo toàn batch.
- **2026-07-23**: hardening toàn bộ luồng JSON của 9Router để chạy với model hỗ trợ `json_schema`, chỉ hỗ trợ JSON object hoặc không hỗ trợ `response_format`.
- **2026-07-23**: hoàn thành product block cho Content Brief: xác minh catalog thật, hiển thị danh sách chờ lưu và tự liên kết sản phẩm khi tạo bài.
- **2026-07-23**: sửa App Proxy storefront về `/apps/shoppable-blog-seo` và ẩn lỗi kỹ thuật của widget khỏi giao diện khách hàng.
- **2026-07-23**: hoàn thành AI FAQ + Schema Generator với evidence validation, query allowlist, review/edit/reorder, guarded Apply/Undo và storefront `FAQPage` JSON-LD khớp nội dung hiển thị.
- **2026-07-23**: xác nhận toàn bộ 8/8 hạng mục AI trong roadmap gốc đã hoàn thành; lượt tiếp theo là hardening invariant cho body HTML.
- **2026-07-23**: thêm quota AI theo tháng cho Free (10 lượt thành công), server-side atomic enforcement, hoàn lượt khi lỗi, chỉ báo lượt còn lại và upgrade path; Pro/Growth không giới hạn.
