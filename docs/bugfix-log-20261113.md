# Nhật ký lỗi đợt 12–13/11/2026 (Export, Skill `/lệnh`, Tin nhắn, Workflow)

Tài liệu này ghi lại các lỗi phát hiện và đã sửa trong lúc làm 5 PR từ #173 đến
#178 (không có #176): ai phát hiện, nguyên nhân, cách sửa, quyết định của chủ
sản phẩm, và những việc còn mở.

Cập nhật lần cuối: 13/11/2026.

## 1. Tóm tắt

| Hạng mục | Kết quả |
| --- | --- |
| PR đã merge | 8 (#173, #174, #175, #177, #178, #179, #180, #181) |
| Commit làm việc | 14 |
| Phạm vi | 79 file, +5.682 / −119 dòng, 2 migration |
| Lỗi chủ sản phẩm báo sau khi dùng trên production | 10, đã sửa (mục 4.1) |
| Lỗi review tự động bắt được trước khi merge | 12, đã sửa (mục 4.2) |
| Lỗi CI và kiểm thử nội bộ bắt được trước khi merge | 3, đã sửa (mục 4.3) |
| Việc còn mở | 3 cần kiểm chứng, 3 chưa làm (mục 5) |
| Test tự động khi merge #178 | unit 253, integration 142, E2E 57 |

Trong 25 lỗi, 15 lỗi được chặn trước khi tới người dùng. 10 lỗi lọt ra
production thuộc hai nhóm: kết quả của workflow (file xuất ra và tin Woli AI),
vì test chỉ kiểm tra file được tạo chứ không kiểm tra nội dung; và thông báo
tin nhắn, vì test chỉ kiểm tra số chưa đọc chứ không kiểm tra người nhận có
được báo hay không.

## 2. Cách làm

Giữ nguyên quy trình ở mục 2 của
[bugfix-log-vuvt-20261028.md](bugfix-log-vuvt-20261028.md), thêm hai điểm:

1. **Chạy `node scripts/check-soft-delete.mjs` trước mỗi lần push.** Hai lần CI
   đỏ trong đợt này đều do bỏ sót bước này.
2. **Review tự động có thêm Vercel Agent Review** bên cạnh Codex. Finding của
   cả hai được xử lý như nhau: kiểm chứng, sửa, trả lời trên thread, resolve.

## 3. Quyết định của chủ sản phẩm

| Chủ đề | Quyết định |
| --- | --- |
| Thu hồi tin nhắn | Cho thu hồi trong 1 giờ sau khi gửi. |
| Realtime | Dùng Supabase Realtime, không chỉ tự tải lại định kỳ. |
| Phạm vi kết bạn | Chỉ người cùng workspace. |
| Workflow gửi cho ai | Bản đầu chỉ gửi cho chính người tạo. |
| Tần suất workflow | Tối thiểu 1 lần/giờ. |
| Chat nhóm | Làm chung đợt Tin nhắn (#175), không tách sau. |
| Hộp thoại export | Dùng dấu "-" giữa hai ngày, ghi rõ Từ / Đến cho từng loại ngày. |

## 4. Các lỗi đã sửa

### 4.1. Chủ sản phẩm báo sau khi dùng trên production (sửa trong #178)

| # | Hiện tượng | Nguyên nhân | Cách sửa |
| --- | --- | --- | --- |
| P1 | Tin Woli AI hiện Markdown thô (`| :--- |`, `**…**`). | Tin của bot hiển thị như văn bản thường. | Tin không có người gửi (bot) hiển thị qua component `Markdown` đã có sẵn bước làm sạch. Tin của người vẫn là văn bản thường. |
| P2 | Workflow gửi báo cáo nhưng không có số chưa đọc cạnh Messages. | Điều kiện `NOT: { authorId: tôi }` loại luôn dòng có `authorId` NULL trong SQL; tin của bot không có người gửi. | Đổi thành "không có người gửi HOẶC người gửi khác tôi" ở danh sách hội thoại và tổng chưa đọc. |
| P3 | PDF chỉ còn chữ có dấu, mất hết a–z; chữ tràn lề. | Chỉ nhúng file font `vietnamese` của Noto Sans; file này không có chữ Latin cơ bản. Không có ngắt dòng cho từ dài. | Nhúng đủ 3 phần font (Latin, Vietnamese, Latin-ext), thường và đậm; vẽ từng đoạn bằng font có ký tự đó. Bảng Markdown vẽ thành bảng, ô tự xuống dòng, lặp dòng tiêu đề khi sang trang; từ dài hơn dòng được ngắt. |
| P4 | Excel chỉ một cột toàn dòng Markdown. | Nội dung được ghi từng dòng, không tách bảng. | Sheet `Report` chứa toàn bộ, bảng thành cột thật. Mỗi bảng thêm một sheet riêng có filter. Số và phần trăm lưu dạng số. |
| P5 | Bảng trong Word là dòng chữ. | Như P4. | Bảng thật, dòng tiêu đề tô nền. |

Sửa trong #180:

| # | Hiện tượng | Nguyên nhân | Cách sửa |
| --- | --- | --- | --- |
| P6 | Có tin nhắn mới nhưng không thấy thông báo nào khi woli đang mở. | Push tới thiết bị vẫn được gửi (đã kiểm chứng trên production), nhưng service worker cố ý không hiện thông báo hệ thống khi woli đang mở, vì với thông báo thường thì chuông đã hiện popup. Tin nhắn không đi qua chuông nên không có gì hiện. | Thêm popup tin nhắn trong app (kèm âm báo, bấm để mở hội thoại); không hiện khi đang ở trang Messages. Trên thiết bị chưa bật push, tab chạy nền tự hiện thông báo hệ thống. |
| P7 | Báo cáo Woli AI chạy theo lịch không có push. | Lần chạy theo lịch chạy sau khi request đã trả lời; push lại được xếp "gửi sau khi trả lời" thêm một lần nữa và bị bỏ khi job kết thúc. Production: tin bot lúc 10:00 ngày 13/11 không cập nhật thời điểm gửi push của thiết bị nào. | Tin của Woli AI gửi push ngay và chờ gửi xong. Nội dung push bỏ ký hiệu Markdown. |
| P8 | Settings → Notifications không có mục cho tin nhắn. | Tin nhắn không thuộc nhóm thông báo nào. | Thêm nhóm "Tin nhắn" với hai công tắc: popup trong app và push tới thiết bị. Máy chủ bỏ qua người đã tắt push tin nhắn. |
| P9 | Lời mời kết bạn: người nhận không thấy thông báo, số cạnh Messages không tăng, tab Bạn bè không có số. | Số cạnh Messages chỉ đếm tin chưa đọc; lời mời chỉ có push (bị ẩn khi app đang mở, như P6). | API trả thêm số lời mời đang chờ; số này cộng vào badge Messages và hiện trên tab Bạn bè; có popup khi lời mời tới. |

Sửa trong #181:

| # | Hiện tượng | Nguyên nhân | Cách sửa |
| --- | --- | --- | --- |
| P10 | Tin Woli AI bị cắt ở cuối, người đọc phải tải file mới xem được hết báo cáo. | Tin bị giới hạn 3.600 ký tự (cột dữ liệu 4.000) và phần vượt bị cắt bỏ. Câu trả lời của AI cũng có thể dừng giữa chừng khi chạm giới hạn 6.000 token. | Bỏ giới hạn ở cột dữ liệu; một tin Woli AI chứa tới 30.000 ký tự, dài hơn thì nối sang tin kế tiếp (bảng lặp tiêu đề). AI được dặn viết cô đọng, đủ mọi mục, và có 12.000 token để viết xong. |

Đi kèm trong #178: file đặt tên theo Skill và ngày thay cho tên định dạng; AI
được dặn viết cho người đọc nghiệp vụ, không đưa tên trường nội bộ (ví dụ
`tasksListed`) vào báo cáo.

### 4.2. Review tự động bắt được trước khi merge

| # | PR | Nguồn | Lỗi | Cách sửa |
| --- | --- | --- | --- | --- |
| R1 | #173 | Codex | Xem trước và tải về dùng chung một hạn mức tần suất, xem trước vài lần là hết lượt tải. | Tách hai hạn mức. |
| R2 | #173 | Codex | Ô CSV bắt đầu bằng `=`, `+`, `-`, `@` có thể chạy như công thức khi mở bằng Excel. | Thêm bước chặn công thức cho CSV. |
| R3 | #173 | Codex | Bảng tổng hợp gộp theo tên, hai project hoặc workspace trùng tên bị cộng chung. | Gộp theo `projectId` / `workspaceSlug`. |
| R4 | #174 | Codex | Tham số dạng chữ của `/lệnh` không qua bước kiểm tra nội dung nhạy cảm. | Đưa tham số chữ vào cùng bước kiểm tra với ghi chú. |
| R5 | #174 | Codex | Link "Mở lần chạy" dẫn sai trang. | Dẫn tới `/w/<slug>/agent-work?run=`. |
| R6 | #174 | Codex | Khoảng ngày chỉ điền một đầu vẫn được nhận. | Từ chối khoảng ngày điền một nửa. |
| R7 | #175 | Codex | Hai máy đang mở cùng hội thoại gửi "đã đọc" qua lại liên tục. | Chỉ ghi "đã đọc" khi thật sự có tin chưa xem. |
| R8 | #175 | Codex | Tin đã sửa hoặc thu hồi nằm ngoài trang mới nhất không được cập nhật trên máy người nhận. | Tín hiệu realtime kèm id; máy nhận tải lại đúng các tin đó (`?ids=`). |
| R9 | #177 | Codex | Lần chạy theo lịch không gắn với người tạo nên không tính vào hạn mức AI của họ. Tham số dạng danh sách có lúc lưu thành chuỗi. | Chạy trong ngữ cảnh AI của người tạo; chuẩn hoá tham số danh sách thành mảng. |
| R10 | #177 | Vercel | Sửa một phần workflow (ví dụ tạm dừng) làm mất tham số và tự bật lại workflow. Nguyên nhân: Zod 4 vẫn áp giá trị mặc định khi dùng `.partial()`. | Schema riêng cho cập nhật, không có giá trị mặc định; chỉ đổi trường được gửi lên. |
| R11 | #178 | Codex, Vercel | Ba lỗi trong chính bản sửa: tên sheet Excel vẫn có thể trùng sau khi đánh số (làm hỏng cả lần chạy); dòng bảng PDF cao hơn một trang bị vẽ ra ngoài trang; tin dài bị cắt giữa một dòng bảng. | Đánh số tới khi tên chưa dùng; dòng cao được vẽ tiếp sang trang sau dưới dòng tiêu đề lặp lại; cắt tin ở cuối dòng. |

| R12 | #180 | Codex, Vercel | Hai lỗi trong chính bản sửa thông báo: khi mất realtime và thiết bị chưa bật push, tab chạy nền không tự kiểm tra nên không báo được tin mới; hai lần tải về sai thứ tự có thể làm popup báo trùng một tin. | Tab nền tự kiểm tra mỗi 2 phút; chỉ dùng kết quả của lần tải mới nhất. |

### 4.3. CI và kiểm thử nội bộ bắt được trước khi merge

| # | PR | Nguồn | Lỗi | Cách sửa |
| --- | --- | --- | --- | --- |
| C1 | #173, #175 | CI (kiểm tra soft-delete) | Hai truy vấn user thiếu điều kiện `deletedAt: null`. | Thêm điều kiện. |
| C2 | #175 | CI (quét lỗ hổng) | RUSTSEC-2026-0486 ở `rustix`, thư viện của bản desktop. | Nâng lên 1.1.6, chỉ sửa đúng dòng đó trong lockfile. |
| C3 | #177 | E2E | Trang Agent Work treo ở "Loading" khi hai request cùng tạo cấu hình lần đầu (trùng khoá, lỗi P2002). | Thử lại một lần khi gặp trùng khoá. |

## 5. Việc còn mở

### 5.1. Cần kiểm chứng trên production

| Việc | Tình trạng |
| --- | --- |
| Gemini trả 402 | Billing đã bật, AI chạy được. Log còn một lần 402 lúc 07:23 ngày 13/11 (giờ Việt Nam); chưa rõ có lặp lại. |
| Realtime giữa hai người | Chưa thử được vì lời mời kết bạn đang chờ chấp nhận. |
| Push notification khi Woli AI gửi báo cáo | Đã sửa (P7); cần chủ sản phẩm xác nhận lại sau lần chạy theo lịch kế tiếp. |

### 5.2. Chưa làm (đã thống nhất để sau)

- Đính kèm file trong chat.
- Workflow gửi kết quả cho người khác.
- Bổ sung Tin nhắn, Workflow, Skill `/lệnh` vào bộ tài liệu hướng dẫn sử dụng.

## 6. Bài học áp dụng cho đợt sau

1. **Test file xuất ra phải đọc lại nội dung.** Với PDF, Excel, Word: trích văn
   bản hoặc đọc ô và so với dữ liệu gốc, không chỉ kiểm tra file tồn tại.
2. **Lọc "không phải của tôi" trong Prisma phải tính dòng NULL.** `NOT` trên
   một cột có thể NULL sẽ bỏ sót dòng NULL.
3. **Zod 4: không dùng `.partial()` trên schema có `.default()` cho API cập
   nhật.** Viết schema cập nhật riêng.
4. **Việc chạy nền không dùng "gửi sau khi trả lời" (`after`) cho bước cuối.**
   Trong job chạy nền, chờ (await) trực tiếp việc cần làm.
5. **Mỗi kênh thông báo mới phải có test "người nhận được báo"** cho cả hai
   trường hợp: app đang mở và app đang đóng.
6. **Font chia theo bộ ký tự phải nhúng đủ các phần** (Latin, Vietnamese,
   Latin-ext) và khai báo trong `outputFileTracingIncludes` để có mặt trên
   serverless.
