# Nhật ký thay đổi (Changelog)

Ghi các thay đổi đã lên production của woli, theo ngày (giờ Việt Nam), mỗi PR
một dòng. Ngày mới nhất ở trên cùng.

**Cách cập nhật (bắt buộc, xem `CLAUDE.md`):** mỗi PR tự thêm dòng của mình
vào ngày merge. Lỗi phát hiện trong lúc làm được ghi chi tiết
ở file bug log của đợt đó (cột "Bug log").

**Lịch sử trước 12/11/2026** không chép lại ở đây:

- Danh sách PR đã merge trên GitHub là nguồn đầy đủ.
- Đợt sửa lỗi theo code review 28/10 – 02/11:
  [bugfix-log-vuvt-20261028.md](bugfix-log-vuvt-20261028.md).

Mỗi ngày có hai phần: bảng thay đổi, và **Lưu ý khi dùng** cho từng thay đổi
(giới hạn, điều kiện để tính năng hoạt động, hành vi dễ gây hiểu nhầm, việc
người dùng hoặc quản trị cần tự làm). Thay đổi nào không có gì cần lưu ý thì
ghi rõ "Không có".

Phân loại: **Mới** (tính năng mới), **Sửa** (sửa lỗi), **Đổi** (thay đổi hành
vi sẵn có), **Vận hành** (cấu hình, hạ tầng, không đổi code).

## 13/11/2026

| Giờ | Loại | PR | Thay đổi | Bug log |
| --- | --- | --- | --- | --- |
| __:__ | Sửa, Mới | #180 | Thông báo tin nhắn: khi woli đang mở, tin nhắn mới và lời mời kết bạn hiện popup kèm âm báo; báo cáo Woli AI chạy theo lịch gửi được push tới thiết bị; Settings → Notifications có dòng "Tin nhắn" để bật/tắt popup và push; lời mời kết bạn đang chờ được cộng vào số cạnh Messages và hiện số trên tab Bạn bè. | [12–13/11](bugfix-log-20261113.md) |
| 09:46 | Vận hành | #179 | Thêm `docs/CHANGELOG.md` và bug log đợt 12–13/11. Từ đây mọi thay đổi đều phải ghi changelog (quy ước trong `CLAUDE.md`). | – |
| 08:25 | Sửa | #178 | File Agent xuất ra đọc được: PDF đủ chữ và có bảng, Excel và Word có bảng thật. Tin Woli AI hiển thị có định dạng và được tính vào số chưa đọc cạnh Messages. | [12–13/11](bugfix-log-20261113.md) |
| 01:28 | Mới | #177 | Workflow chạy theo lịch (giờ / ngày / tuần / tháng, tối thiểu 1 lần/giờ), kết quả gửi vào hộp thư Woli AI của người tạo. Migration `20270114000000_agent_workflows`. | [12–13/11](bugfix-log-20261113.md) |

### Lưu ý khi dùng

**Thông báo tin nhắn (#180)**

- Popup tin nhắn không hiện khi bạn đang ở trang Messages; ở đó danh sách hội
  thoại và số chưa đọc tự cập nhật.
- Hội thoại nhóm đã tắt thông báo (mute) không hiện popup, không gửi push và
  không tính vào số cạnh Messages.
- Push tới thiết bị chỉ đến khi thiết bị đó đã cho phép thông báo của woli
  (Settings → Notifications → nút cho phép). Mỗi trình duyệt, mỗi máy phải bật
  riêng. Trên iPhone/iPad phải cài woli ra màn hình chính.
- Khi woli đang mở và đang được nhìn thấy, chỉ có popup trong app, không có
  thông báo hệ thống (để không báo hai lần).
- Tắt "Tin nhắn" ở cột popup chỉ tắt popup và âm báo; số chưa đọc cạnh Messages
  vẫn đếm.
- Số cạnh Messages = tin chưa đọc + lời mời kết bạn đang chờ bạn trả lời.
- Nếu kết nối realtime bị gián đoạn, popup có thể trễ tối đa 30 giây.

**Changelog (#179)**: Không có.

**File Agent xuất ra (#178)**

- File của các lần chạy trước ngày 13/11 không tự đổi; chạy lại để có file mới.
- Tin Woli AI dài hơn khoảng 3.600 ký tự được cắt ở cuối dòng và kèm link mở
  lần chạy; bản đầy đủ nằm trong file đính kèm và trong Agent Work.
- Trong Excel, phần trăm lưu dạng số (59,61% là 0,5961, định dạng %), dùng
  được ngay cho công thức.

**Workflow theo lịch (#177)**

- Tần suất dày nhất là 1 lần/giờ, tức mỗi workflow tối đa 24 lần/ngày.
- Mỗi người tối đa 10 workflow đang bật (tính trên mọi workspace); muốn thêm
  phải tạm dừng bớt.
- Giờ chạy theo giờ Việt Nam. Hệ thống quét 5 phút một lần nên kết quả có thể
  đến trễ tối đa khoảng 5 phút, cộng thời gian AI chạy.
- Kết quả chỉ gửi cho người tạo workflow, vào hộp thư Woli AI. Chưa gửi được
  cho người khác.
- Workflow lỗi 3 lần liên tiếp sẽ tự tạm dừng và báo trong hộp thư Woli AI;
  sửa xong phải bật lại bằng tay.
- Mỗi lần chạy tính vào hạn mức AI của người tạo (30 lần chạy Agent mỗi 10
  phút, chung với chạy tay) và vào chi phí Gemini.
- Lần chạy có nội dung nhạy cảm không tự gửi kết quả mà chờ người tạo duyệt
  trong Agent Work.
- "Ngày 31" trong lịch tháng nghĩa là ngày cuối tháng.
- Quản trị: workflow chỉ chạy khi job `woli-workflows-tick` trên Supabase và
  biến `CRON_SECRET` trên Vercel còn đúng; đổi một bên phải đổi bên kia.

Vận hành (không qua PR):

- Vercel: thêm `CRON_SECRET` và 2 biến môi trường realtime, rồi redeploy.
- Supabase: Vault secret `woli_cron_secret` và job pg_cron
  `woli-workflows-tick` gọi `/api/workflows/tick` mỗi 5 phút. Cách cài:
  [WORKFLOWS-CRON.md](WORKFLOWS-CRON.md).
- Gemini: bật billing sau lỗi 402 "prepayment credits depleted".

## 12/11/2026

| Giờ | Loại | PR | Thay đổi | Bug log |
| --- | --- | --- | --- | --- |
| 21:24 | Mới | #175 | Tin nhắn: kết bạn với người cùng workspace, chat 1-1 và nhóm, tag task bằng `#`, sửa và thu hồi tin trong 1 giờ, hộp thư Woli AI, cập nhật realtime qua Supabase Realtime (dự phòng: tự tải lại mỗi 30 giây). Migration `20270113000000_messages`. Bản desktop: `rustix` 1.1.6. | [12–13/11](bugfix-log-20261113.md) |
| 20:35 | Mới, Đổi | #174 | Chạy Skill bằng `/lệnh` có tham số, từ Agent Work hoặc từ khung chat AI. Hộp thoại export ghi rõ Từ – Đến cho từng loại ngày. | [12–13/11](bugfix-log-20261113.md) |
| 20:03 | Mới | #173 | "Export dữ liệu của tôi": task từ mọi workspace mình tham gia, có lọc, ra XLSX hoặc CSV. | [12–13/11](bugfix-log-20261113.md) |

### Lưu ý khi dùng

**Tin nhắn (#175)**

- Chỉ kết bạn được với người đang cùng ít nhất một workspace. Chat 1-1 cần lời
  mời đã được chấp nhận; thành viên nhóm thì không cần là bạn.
- Sửa và thu hồi tin chỉ trong 1 giờ sau khi gửi.
- Giới hạn: tin dài tối đa 4.000 ký tự, tag tối đa 10 task mỗi tin, nhóm tối
  đa 100 người, 60 tin/phút, 40 lời mời kết bạn/ngày, 20 nhóm mới/ngày.
- Task được tag chỉ hiện với người có quyền xem task đó.
- Chưa gửi được file đính kèm trong chat.
- Khi mất kết nối realtime, trang hiện dòng báo và tự tải lại mỗi 30 giây.
- Quản trị: realtime cần 2 biến môi trường Supabase trên Vercel; thiếu thì app
  vẫn chạy ở chế độ tải lại 30 giây.

**Skill `/lệnh` (#174)**

- Gõ `/` trong khung chat AI hoặc Agent Work để chọn Skill; khoảng ngày phải
  điền đủ cả Từ và Đến.
- Tham số dạng chữ cũng được kiểm tra nội dung nhạy cảm; nếu dính, lần chạy
  chờ duyệt thay vì chạy ngay.
- Lần chạy bị treo quá 1 giờ được tự đánh dấu thất bại để không chặn lần sau.

**Export dữ liệu của tôi (#173)**

- Tối đa 20.000 dòng mỗi lần; vượt thì phải thu hẹp bộ lọc.
- Tối đa 20 lần tải mỗi 10 phút (xem trước: 120 lần).
- Chỉ gồm task bạn có quyền xem tại thời điểm export.
- Trong CSV, ô bắt đầu bằng `=`, `+`, `-`, `@` được thêm dấu nháy đầu để Excel
  không chạy như công thức; XLSX không bị ảnh hưởng.
