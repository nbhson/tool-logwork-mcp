# MCP Tools

Chia tools thành ba nhóm.

## Nhóm 1 — Read

| Tool                     | Chức năng                         |
| ------------------------ | --------------------------------- |
| `tempo_get_worklogs`     | Lấy worklog theo khoảng thời gian |
| `tempo_get_worklog`      | Lấy chi tiết một worklog          |
| `jira_search_issues`     | Tìm kiếm Jira issue               |
| `tempo_get_week_summary` | Tổng hợp dữ liệu tuần             |

## Nhóm 2 — Validate và Preview

| Tool                     | Chức năng                         |
| ------------------------ | --------------------------------- |
| `tempo_preview_worklog`  | Kiểm tra dữ liệu dự kiến ghi      |
| `tempo_check_duplicate`  | Tìm các worklog có khả năng trùng |
| `tempo_validate_worklog` | Kiểm tra các quy tắc nghiệp vụ    |

## Nhóm 3 — Write

| Tool                   | Chức năng        |
| ---------------------- | ---------------- |
| `tempo_create_worklog` | Tạo worklog      |
| `tempo_update_worklog` | Cập nhật worklog |

> **Lưu ý:** Ở phiên bản đầu tiên, không cung cấp tool xóa worklog.

`tempo_preview_worklog` không cần ghi dữ liệu, còn `tempo_create_worklog` có tác dụng phụ. Việc đặt tên và mô tả rõ ràng giúp AI phân biệt các thao tác này.

## Quy ước đầu vào

Ví dụ dữ liệu dùng để tạo worklog:

```json
{
  "issueKey": "SP0168-3839",
  "date": "2026-10-28",
  "durationMinutes": 90,
  "description": "Implement and test UI component"
}
```

Đây là schema đầu vào do hệ thống tự thiết kế cho MCP, không phải payload chính thức của Tempo API. MCP Server sẽ chuyển đổi dữ liệu sang đúng schema mà API yêu cầu.

Nên dùng `durationMinutes` thay vì để nhiều định dạng như `1h30m`, `90 minutes` và `1.5 hours` chạy xuyên suốt các lớp. Việc phân tích cú pháp có thể thực hiện ở đầu vào; bên trong hệ thống nên chuẩn hóa thành số phút.
