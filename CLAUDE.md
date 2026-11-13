@AGENTS.md

# Changelog (bắt buộc)

Mọi thay đổi vào `master` phải được ghi lại, trong chính PR đó:

- Thêm một dòng vào `docs/CHANGELOG.md` ở ngày merge (giờ Việt Nam), ngày mới nhất ở trên cùng: giờ, loại (Mới / Sửa / Đổi / Vận hành), số PR, thay đổi viết cho người dùng nghiệp vụ.
- Lỗi phát hiện trong lúc làm (người dùng báo, review tự động, CI, test) được ghi vào file bug log của đợt (`docs/bugfix-log-<yyyymmdd>.md`): hiện tượng, nguyên nhân, cách sửa. Việc còn mở cũng ghi ở đó.
- Thay đổi vận hành không qua PR (biến môi trường, cron, cấu hình dịch vụ) cũng ghi vào CHANGELOG ở lần PR kế tiếp.
- Số PR chỉ biết sau khi mở PR: mở PR trước, rồi điền số vào CHANGELOG trong commit tiếp theo của cùng PR.
