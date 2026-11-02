# Nhật ký sửa lỗi theo code review Feedback_VuVT_20261028

Tài liệu này ghi lại quá trình sửa toàn bộ lỗi trong bản code review
`Feedback_VuVT_20261028` (37 mã lỗi, BUG-01 đến BUG-37) và 8 yêu cầu bổ sung
của chủ sản phẩm trong lúc sửa (U1–U8): cách làm, quyết định của chủ sản phẩm,
trạng thái từng lỗi, những lỗi review tự động bắt được trong chính bản sửa, và
các việc vận hành còn chờ người làm.

Cập nhật lần cuối: 02/11/2026.

## 1. Tóm tắt

| Hạng mục | Kết quả |
| --- | --- |
| Mã lỗi trong bản review | 37, tất cả đã xử lý |
| Yêu cầu bổ sung (U1–U8) | 8, tất cả đã merge |
| Số PR | Mỗi lỗi / yêu cầu một PR (BUG-30 tách 6 PR, BUG-12 tách 12a + 12) |
| Lỗi do chính bản sửa gây ra, review bắt được trước khi merge | 29 (mục 5) |
| Test tự động hiện có | unit 198, integration 134, E2E 40 (+1 perf ngoài CI) |

Không có lỗi nào bị bỏ qua. Một phần của BUG-06a (ảo hoá bảng khi đang **nhóm**
theo trường) được ghi là việc tiếp theo, có lý do ở mục 4.3.

## 2. Cách làm (áp dụng cho mọi lỗi)

1. **Mỗi lỗi một PR**, trên nhánh `claude/pensive-edison-j08890`, làm tuần tự.
   Lỗi lớn được tách nhỏ (BUG-30 thành 30a–30f; BUG-12 thành 12a và 12).
2. **Test trước, thấy đỏ rồi mới sửa.** Mỗi lỗi có test tái hiện (unit,
   integration trên PostgreSQL thật, hoặc Playwright) chạy đỏ trên code cũ.
   Thay đổi chỉ ở workflow / Docker / desktop / Android được kiểm bằng công cụ
   tương ứng (zizmor, test Rust/JVM, chạy script sinh cấu hình).
3. **Kiểm tra đầy đủ trước khi push:** `tsc`, `eslint`, unit test,
   `next build`, integration test, toàn bộ E2E (giống CI).
4. **Review tự động (Codex) trên mỗi PR.** Mọi finding đều được kiểm chứng,
   viết test đỏ, sửa, trả lời trên thread (ghi rõ commit) rồi resolve.
5. **Chỉ merge khi CI xanh.** Sau mỗi merge, nhánh được đưa về `master` mới
   nhất rồi mới làm lỗi tiếp theo.
6. **Dữ liệu production chỉ đọc**, chỉ để chẩn đoán. Không sửa dữ liệu
   production, không giải mã biến môi trường, không đưa secret vào chat hay
   code. Thay đổi schema chỉ qua Prisma migration.

## 3. Quyết định của chủ sản phẩm

| Lỗi | Quyết định |
| --- | --- |
| BUG-05 | Trần AI: 60 lượt/người/10 phút, 600 lượt/giờ toàn hệ thống, chỉnh được bằng biến môi trường. Production dùng thực tế (30 ngày): p99 là 5 lượt/người/10 phút và 7 lượt/giờ. |
| BUG-08 | Giữ đăng ký mở; bắt buộc xác minh email trước khi tạo workspace, vào bằng link mời dùng chung, hoặc kiểm tra AI. `SIGNUP_ALLOWED_DOMAINS` để trống (mở). |
| BUG-11 | Giữ các reply wiki mồ côi (reply của bình luận đã xoá vẫn hiện). |
| BUG-17 | Chuyển file lớn lên thư mục Drive của nhóm; không viết lại lịch sử git. |
| BUG-19 | Tổng hợp theo tháng trước khi xoá `ai_usage_events` cũ. |
| BUG-23 | Lên Node 24 ở mọi nơi (Docker và CI). |
| BUG-31 | (a) Chủ project vẫn chuyển project cho thành viên đủ điều kiện; chỉ giới hạn handover hàng loạt của admin. (b) Admin hệ thống phải bật chế độ hỗ trợ, thao tác được ghi log. |
| BUG-32 | Cấm tự duyệt đổi thưởng; giữ tự xác nhận (ghi vào tài liệu); sửa khoá khi đổi owner song song. |
| U8 | Bảng tóm tắt đếm đủ giờ cho từng người khi task có nhiều người (A và B cùng làm task 6 giờ → mỗi người 6 giờ); task mẹ chỉ tính phần giờ riêng (giờ mẹ trừ giờ con) để không đếm trùng. |

## 4. Trạng thái từng lỗi

### 4.1. Lỗi trong bản review (đã merge)

| Lỗi | Mức | PR | Nội dung sửa |
| --- | --- | --- | --- |
| BUG-01 | Nghiêm trọng | #89 | `?userId=` không còn đọc được thư kudos riêng tư của người khác. |
| BUG-04 | Nghiêm trọng | #90 | Cron lưu trữ audit log đặt `SET LOCAL` trước khi chuyển dòng. |
| BUG-28 | Cao | #91 | Cookie phiên đã thu hồi không dùng lại / gia hạn được qua `/api/auth/session`. |
| BUG-29 | Trung bình | #92 | Second Brain không còn hiện trang / quyết định của project bị ẩn. |
| BUG-30a–f | Trung bình | #93–#98 | Khôi phục task, audit log, phụ thuộc task, quyết định, wiki, OKR đều tôn trọng project ẩn. |
| BUG-21 | Trung bình | #99 | `callbackUrl` không chuyển người dùng ra trang ngoài. |
| BUG-37 | Thấp | #100 | Dữ liệu sai định dạng trả 400; giới hạn 72 byte của bcrypt; số ngẫu nhiên không lệch. |
| BUG-18 | Trung bình | #101 | Placeholder thay bằng thao tác DOM, không ghép chuỗi vào HTML đã làm sạch. |
| BUG-10 | Trung bình | #102 | CSP `script-src` với nonce mỗi trang (đang Report-Only). |
| BUG-22 | Trung bình | #103 | Bộ chặn ZIP kiểm kích thước thật; xem trước Word có giới hạn. |
| BUG-09 | Thấp | #104 | Field "API Result" chặn dải IP nội bộ, kiểm IP lúc kết nối. |
| BUG-15 | Thấp | #105 | Request ghi từ site khác bị từ chối (kiểm Origin). |
| BUG-25 | Thấp | #106 | Upload trực tiếp lưu loại file đã kiểm và kích thước thật. |
| BUG-08 | Cao | #107 | Cổng xác minh email; danh sách domain tuỳ chọn. |
| BUG-17 | Thấp | #108 | Video, slide, tài liệu lớn chuyển sang Google Drive. |
| BUG-05 | Cao | #109 | Mọi lượt gọi AI tính vào trần theo người và toàn hệ thống. |
| BUG-14 | Trung bình | #110 | Mời bằng email chỉ lộ tài khoản đã xác minh, tối đa 100 địa chỉ/giờ. |
| BUG-13 | Trung bình | #111 | Rate limit theo IP chỉ tin proxy khai báo trong `TRUSTED_PROXY`. |
| BUG-03 | Thấp | #112 | CI giữ migration mới ở cuối; tài liệu quy tắc đặt tên. |
| BUG-19 | Trung bình | #113 | Lưu trữ audit giữ IP / user agent, chỉ được thêm; cron chạy theo lô; AI usage cũ tổng hợp theo tháng. |
| BUG-31 | Trung bình | #114 | Admin không lấy lại được project ẩn của thành viên đang hoạt động; admin hệ thống cần chế độ hỗ trợ. |
| BUG-32 | Trung bình | #115 | Cấm tự duyệt đổi thưởng; khoá trước khi đổi owner. |
| BUG-33 | Trung bình | #116 | Cập nhật thư viện Rust của desktop (zip 4 → 9, rustls, tokio…); phần còn lại ghi trong `osv-scanner.toml`. |
| BUG-02 | Trung bình | #117 | `npm audit` chặn CI ở mức high; workflow audit hằng tuần (npm + OSV); Dependabot cho Gradle. |
| BUG-20 | Cao | #131 | Khoá ký và token phát hành chỉ đến job release (tag, có người duyệt). |
| BUG-24 | Trung bình | #132 | Ghim mọi action theo SHA, bỏ token checkout, không dùng cache cho bản ký. zizmor: 0 high / 0 medium. |
| BUG-23 | Trung bình | #133 | Docker Node 24 ghim digest; migrate dùng Prisma CLI trong lockfile, chạy non-root. |
| BUG-16 | Trung bình | #134 | Không còn host server mặc định cứng trong bản desktop / Android. |
| BUG-26 | Cao | #141 | Chỉ nhận file cài / gói cập nhật từ URL release của chính repo. |
| BUG-36 | Thấp | #142 | Hộp thoại "Đăng ký bản phát hành" gửi sha256 và platform. |
| BUG-34 | Trung bình | #143 | Updater desktop bắt buộc version nằm trong chữ ký (chống hạ cấp). |
| BUG-35 | Trung bình | #144 | App Android chỉ mở trang https của chính woli từ link app khác gửi. |
| BUG-27 | Trung bình | #145 | Bản phát hành có thể ký Authenticode qua dịch vụ ký từ xa; release thất bại nếu chưa ký + timestamp. |
| BUG-11 | Trung bình | #146 | Bình luận task, lịch sử task, file đính kèm, bình luận wiki phân trang bằng cursor. |
| BUG-12a | Trung bình | #147 | "Hoạt động gần đây" ở Home không còn hiện task đã xoá. |
| BUG-12 | Trung bình | #148 | CI chặn truy vấn mới quên lọc `deletedAt`. |
| BUG-07 | Trung bình | #149 | Sửa task chỉ tính lại lookup / rollup từ các task liên kết, không tải cả project (360 ms → 16 ms). |
| BUG-06a | Trung bình | #150 | Bảng task chỉ render các dòng đang nhìn thấy (ảo hoá); 5.000 task vẫn mượt. |


### 4.2. Yêu cầu bổ sung trong lúc sửa (U1–U8, đã merge)

| Mã | PR | Nội dung |
| --- | --- | --- |
| U1 | #122 | Báo cáo AI nói "không có giờ thực tế" dù task có giờ: biểu đồ thiếu trường giá trị giờ báo lỗi rõ; báo cáo tính giờ trực tiếp từ task (mỗi người được tính đủ, task mẹ tính phần riêng); thời gian focus ở task con cộng lên task mẹ. |
| U2 | #123 | Lọc "Assignee là Hiếu" ra cả task giao cho Hiếu và Tâm. |
| U3 | #124 | Ô nhập trong hộp thoại "Task mới" căn giữa theo chiều dọc. |
| U4 | #125 | Bộ lọc kết hợp AND và OR (nhóm điều kiện, lồng được nhiều cấp). |
| U5 | #126 | Nhóm bảng theo nhiều tiêu chí (nhóm đầu là mẹ, các nhóm sau là con). |
| U6 | #127 | Task con thụt vào, chữ nhỏ và nhạt hơn task mẹ; rê chuột vào đường phân cách giữa 2 dòng hiện dấu "+" để chèn dòng. |
| U7 | #128 | Giờ task mẹ phải ≥ tổng giờ task con; nếu không, hiện popup để nhập lại cho đúng. |
| U8a | #129 | Dashboard: widget "Bảng tóm tắt" (dòng × cột × giá trị, có tổng), xuất CSV / XLSX. |
| U8b | #130 | Dashboard: Append nhiều project và Merge theo trường khoá, giống Power Query. |

### 4.3. Phần còn để làm tiếp

**BUG-06a khi bảng đang nhóm theo trường.** Bảng không nhóm (trường hợp phổ
biến và nặng nhất) đã được ảo hoá. Khi nhóm, mỗi nhóm vẽ phần riêng của nó
(tiêu đề, thu gọn, nhóm lồng nhiều cấp từ U5) nên chưa ảo hoá. Cách làm tiếp:
trải phẳng tiêu đề nhóm và dòng thành một danh sách rồi ảo hoá danh sách đó.
Một project có vài nghìn task **và** đang nhóm vẫn có thể chậm.

## 5. Lỗi do chính bản sửa gây ra, đã được review bắt

Trước khi merge, review tự động (Codex), E2E hoặc CI tìm ra các lỗi nằm trong
chính bản sửa. Tất cả đều được tái hiện bằng test đỏ rồi mới sửa:

| PR | Lỗi bị bắt |
| --- | --- |
| #98 (BUG-30f) | Sửa objective làm mất liên kết cha khi KR cha nằm trong project ẩn. |
| #103 (BUG-22) | Tên file trong header khác danh mục ZIP qua mặt giới hạn XML; file không nén bỏ qua giới hạn kích thước. |
| #104 (BUG-09) | Response nén gzip/br của API bị báo lỗi. |
| #107 (BUG-08) | E2E: bước chuẩn bị bị cổng xác minh chặn. |
| #117 (BUG-02) | Advisory của minimatch (chỉ dev) làm audit đỏ: tách mức audit cho production và dev. |
| #122 (U1) | Thời gian focus ở task mẹ và con bị trừ mất: focus giờ cộng lên mọi task mẹ; bảng giờ trong báo cáo ghi rõ phạm vi. |
| #125 (U4) | "Lọc theo trường này" lồng nhóm 2 cấp nhưng panel chỉ hiện 1 cấp: panel vẽ nhóm đệ quy. |
| #126 (U5) | Xoá trường ở giữa chuỗi nhóm làm task mới rơi sai nhóm. |
| #127 (U6) | Task thuộc 2 nhóm: dấu "+" chèn vào nhóm cuối thay vì nhóm được click. |
| #128 (U7) | Làm tròn từng task con làm giá trị gợi ý không lưu được; trang task con bị đổi thành task mẹ; dán hàng loạt và hộp thoại chi tiết hoàn thành bỏ qua kiểm tra. |
| #129 (U8a) | Bộ lọc bỏ task con làm giờ của nó dồn sang task mẹ; trường ngày không theo nhóm ngày / tuần / tháng; tên file tải về có dấu bị trình duyệt đổi thành "download". |
| #130 (U8b) | Formula của project append bị tính lại bằng công thức project chính; cột Created time / by khi merge lấy của task bên trái. |
| #131 (BUG-20) | Chạy kênh beta cho version đã phát hành stable sẽ ghi đè file của bản stable: release dừng lại nếu tag đã thuộc kênh kia. |
| #146 (BUG-11) | Tải lại danh sách khi trang cũ còn đang tải: response cũ chen vào danh sách mới. Mỗi lần tải giờ có "thế hệ", response cũ bị bỏ. |
| #148 (BUG-12) | Ghi chú `// soft-delete:` của một truy vấn cũng miễn kiểm tra cho truy vấn ngay sau nó: ghi chú giờ chỉ áp dụng cho câu lệnh / phần tử của chính nó. |
| #149 (BUG-07) | Chuỗi liên kết dài (2.000 task phụ thuộc nối tiếp) tạo ~2.000 truy vấn liên tiếp trong transaction: quá 8 cấp thì quay về tải cả project bằng 1 truy vấn. |
| #150 (BUG-06a) | Ô đang sửa (chưa rời ô) bị gỡ khỏi trang khi cuộn ra xa, mất nội dung chưa lưu: dòng đang có focus giờ luôn được giữ. Dòng được giữ nằm xa cửa sổ làm co chiều cao cuộn: mỗi dòng giờ có khoảng trống riêng phía trên. |

Bài học: review tự động, E2E và CI bắt được loại lỗi mà unit / integration
test của chính người sửa bỏ sót, nên giữ cả ba trong quy trình.

## 6. Việc vận hành còn chờ người làm (không giao cho AI)

| Việc | Lý do | Ai làm |
| --- | --- | --- |
| Cấu hình lại trường giá trị của các biểu đồ trong dashboard "HRG" trên production | Các widget này thiếu trường giá trị / dimension nên trước đây hiện 0; giờ chúng báo lỗi rõ thay vì số sai. Dữ liệu production không bị sửa. | Người quản lý dashboard |
| Đặt quota cap cho API key Gemini trên Google Cloud | Trần trong app (BUG-05) đếm theo lượt; Google mới là chốt chặn cuối về chi phí. | Chủ tài khoản GCP |
| Chia sẻ thư mục Drive chứa video / pptx (BUG-17) | Hiện chỉ chủ sở hữu mở được. | Chủ thư mục Drive |
| Bật branch protection cho `master` | Chưa bắt buộc CI xanh trước khi merge. | Quản trị GitHub |
| Tạo environment `release` (người duyệt, chỉ tag `desktop-v*` / `android-v*`), tag ruleset, chuyển 7 secret vào environment, **đổi `DESKTOP_RELEASE_TOKEN`** (BUG-20) | Token cũ từng lộ ra mọi nhánh. Chưa làm thì job release chạy không có secret (không ký, không đăng ký). | Quản trị GitHub |
| Đặt biến repo `BASEWORK_SERVER_URL` và `ANDROID_APP_HOST` (BUG-16) | Không còn host mặc định; bản desktop / Android sẽ dừng build nếu thiếu. | Quản trị GitHub |
| Mua chứng chỉ ký Authenticode và đặt `WINDOWS_SIGN_COMMAND` (BUG-27) | Chứng chỉ mới phải nằm trên HSM; có thể mất vài tuần. Chưa có thì bản Windows vẫn build nhưng chưa ký (có cảnh báo). | Chủ sản phẩm |
| Rà các PR Dependabot đang mở | Một số bản nâng cấp có thể liên quan bảo mật. | Quản trị GitHub |

## 7. Điểm cần lưu tâm

1. **CSP đang Report-Only.** Trước khi chuyển sang chặn thật, xem log
   `/api/csp-report` trên production vài ngày và xử lý các nguồn `eval`.
2. **Tự host sau nginx (BUG-13, BUG-15).** Đặt `proxy_set_header Host $host`
   và `TRUSTED_PROXY`; xem `docs/OPERATIONS.md`.
3. **Người dùng chưa xác minh email (BUG-08)** giữ quyền thành viên cũ nhưng gặp
   403 khi tạo workspace mới; cần theo dõi cấu hình mail.
4. **Trần AI toàn hệ thống** có thể bị vài tài khoản cố ý chạm tới; server ghi
   `[ai] global AI cap reached`, kiểm tra trong mục AI usage của trang admin.
5. **Mật khẩu dài hơn 72 byte** bị từ chối khi đặt mới (tiếng Việt có dấu chạm
   giới hạn sớm hơn).
6. **Lịch sử git vẫn chứa file lớn (BUG-17)**; chỉ giảm được bằng force push,
   không khuyến nghị.
7. **Danh sách phân trang (BUG-11):** API bình luận / lịch sử / file trả
   `{ items, nextCursor }`. Client cũ (bản desktop / app đã cài trước) gọi các
   API này sẽ cần cập nhật; giao diện web đã có nút "Tải thêm".
8. **Bảng tóm tắt (U8a) là person-hours:** tổng cột Assignee có thể lớn hơn tổng
   giờ thực của dự án khi task có nhiều người — đúng như yêu cầu, nhưng cần nói
   rõ khi trình bày báo cáo.
9. **Tên file xuất CSV / XLSX** được bỏ dấu ("Giờ làm việc" → "Gio lam viec")
   vì trình duyệt bỏ tên file có dấu; nội dung file vẫn giữ tiếng Việt.

## 8. Cách kiểm tra lại ở máy

```bash
npm ci && npx prisma generate
npx eslint src tests e2e --max-warnings=0
npx tsc --noEmit -p .
npm test                      # unit test
npm run build
TEST_DATABASE_URL=postgresql://basework:basework@localhost:5432/basework_it npm run test:integration
CI=1 npm run test:e2e         # cần DATABASE_URL trỏ tới CSDL đã migrate
```
