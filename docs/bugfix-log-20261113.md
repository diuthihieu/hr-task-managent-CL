# Nhật ký lỗi đợt 12–13/11/2026 (Export, Skill `/lệnh`, Tin nhắn, Workflow)

Tài liệu này ghi lại các lỗi phát hiện và đã sửa trong lúc làm 5 PR từ #173 đến
#178 (không có #176): ai phát hiện, nguyên nhân, cách sửa, quyết định của chủ
sản phẩm, và những việc còn mở.

Cập nhật lần cuối: 13/11/2026.

## 1. Tóm tắt

| Hạng mục | Kết quả |
| --- | --- |
| PR đã merge | 5 (#173, #174, #175, #177, #178) |
| Commit làm việc | 14 |
| Phạm vi | 79 file, +5.682 / −119 dòng, 2 migration |
| Lỗi chủ sản phẩm báo sau khi dùng trên production | 5, đã sửa (mục 4.1) |
| Lỗi review tự động bắt được trước khi merge | 11, đã sửa (mục 4.2) |
| Lỗi CI và kiểm thử nội bộ bắt được trước khi merge | 3, đã sửa (mục 4.3) |
| Việc còn mở | 3 cần kiểm chứng, 3 chưa làm (mục 5) |
| Test tự động khi merge #178 | unit 253, integration 142, E2E 57 |

Trong 19 lỗi, 14 lỗi được chặn trước khi tới người dùng. 5 lỗi lọt ra
production đều nằm ở kết quả của workflow (file xuất ra và tin Woli AI): các
test lúc đó chỉ kiểm tra file được tạo, không kiểm tra nội dung file hiển thị
ra sao.

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
| Push notification khi Woli AI gửi báo cáo | Chỉ đến khi trình duyệt hoặc điện thoại đã bật nhận thông báo; chưa xác nhận trên máy chủ sản phẩm. |

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
4. **Font chia theo bộ ký tự phải nhúng đủ các phần** (Latin, Vietnamese,
   Latin-ext) và khai báo trong `outputFileTracingIncludes` để có mặt trên
   serverless.
