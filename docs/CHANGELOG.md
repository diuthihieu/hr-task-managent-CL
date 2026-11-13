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

Phân loại: **Mới** (tính năng mới), **Sửa** (sửa lỗi), **Đổi** (thay đổi hành
vi sẵn có), **Vận hành** (cấu hình, hạ tầng, không đổi code).

## 13/11/2026

| Giờ | Loại | PR | Thay đổi | Bug log |
| --- | --- | --- | --- | --- |
| __:__ | Sửa, Mới | #___ | Thông báo tin nhắn: khi woli đang mở, tin nhắn mới và lời mời kết bạn hiện popup kèm âm báo; báo cáo Woli AI chạy theo lịch gửi được push tới thiết bị; Settings → Notifications có dòng "Tin nhắn" để bật/tắt popup và push; lời mời kết bạn đang chờ được cộng vào số cạnh Messages và hiện số trên tab Bạn bè. | [12–13/11](bugfix-log-20261113.md) |
| 09:46 | Vận hành | #179 | Thêm `docs/CHANGELOG.md` và bug log đợt 12–13/11. Từ đây mọi thay đổi đều phải ghi changelog (quy ước trong `CLAUDE.md`). | – |
| 08:25 | Sửa | #178 | File Agent xuất ra đọc được: PDF đủ chữ và có bảng, Excel và Word có bảng thật. Tin Woli AI hiển thị có định dạng và được tính vào số chưa đọc cạnh Messages. | [12–13/11](bugfix-log-20261113.md) |
| 01:28 | Mới | #177 | Workflow chạy theo lịch (giờ / ngày / tuần / tháng, tối thiểu 1 lần/giờ), kết quả gửi vào hộp thư Woli AI của người tạo. Migration `20270114000000_agent_workflows`. | [12–13/11](bugfix-log-20261113.md) |

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
