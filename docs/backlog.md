# Backlog

Các tính năng đã được đánh giá nhưng chủ động hoãn lại, kèm nhận định scope.

## Bulk edit worklog (nhiều entry cùng lúc)

**Đánh giá (đợt review 2, 2026-11):** HOÃN LÀI — quá lớn so với một đợt an toàn.

Vì sao lớn:

- Phải mở rộng pipeline write triple-gated: approval token hiện bind SHA-256
  của MỘT payload; bulk cần token bind danh sách payload hoặc N token.
- Partial failure: entry thứ 3/10 fail → các entry còn lại là uncertain
  outcome; cần chính sách tiếp tục/dừng + báo cáo từng entry (created /
  failed / uncertain) và chiến lược verify sau ghi cho từng entry.
- Schema preview hiện là discriminated union create|update cho một entry;
  bulk phải hỗ trợ cả hai operation trộn lẫn hoặc tách tool riêng
  (`tempo_preview_bulk_worklog` + `tempo_create_bulk_worklog`?) → tăng bề mặt
  công cụ và phức tạp approval UI cho agent.

Điều kiện làm lại: khi có nhu cầu thực từ usage và đã ổn định pipeline
single-entry; ưu tiên thiết kế "một token bind cả batch + idempotency key
per entry".

## Template tuần (đăng ký sẵn lịch tuần lặp lại)

**Đánh giá:** HOÃN LÀI — phụ thuộc bulk edit (mỗi ngày một entry = một batch
write). Khi bulk edit có sẵn, template tuần chỉ là logic sinh proposals từ
mẫu (issue + giờ cố định theo ngày làm việc), sau đó đi cùng pipeline preview
→ approve → bulk write. Cần trả lời trước: week start Thứ hai cố định đã đủ
chưa (hiện server cố định Mon–Sun, xem
`tests/integration/weekly-summary-timezone.test.ts`); có cần `weekStartsOn`
option cho khách hàng tuần-bắt-đầu-Chủ-nhật hay không.

## `weekStartsOn` option cho tempo_get_week_summary

**Đánh giá:** nhỏ (schema + `weekStartIso` nhận tham số), nhưng là thay đổi
API tool công khai (thêm field vào JSON Schema). Chưa làm vì chưa có yêu cầu
thực; hành vi hiện tại (tuần Mon–Sun) đã được khoanh vùng bằng regression
tests.
