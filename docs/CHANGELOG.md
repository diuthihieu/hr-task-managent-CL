# Nhật ký thay đổi (Changelog)

Ghi các thay đổi đã lên production của woli, theo ngày (giờ Việt Nam), mỗi PR
một dòng. Ngày mới nhất ở trên cùng.

**Cách cập nhật:** sau mỗi lần merge vào `master`, thêm một dòng vào ngày tương
ứng trong cùng PR hoặc PR kế tiếp. Lỗi phát hiện trong lúc làm được ghi chi tiết
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
