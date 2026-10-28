# Thiết kế Skill

Skill cần hướng dẫn AI thực hiện quy trình, chứ không chỉ liệt kê tên các tools.

## Cấu trúc file

Ví dụ file: `skills/tempo-timesheet/SKILL.md`

Nội dung nên được tổ chức thành các phần:

```text
Tempo Timesheet Skill
│
├── Purpose
│   └── Quản lý timesheet qua MCP
│
├── Data Integrity Rules
│   ├── Không bịa thời gian
│   ├── Không tự suy diễn công việc đã hoàn thành
│   └── Kiểm tra dữ liệu hiện có
│
├── Workflows
│   ├── Daily Summary
│   ├── Weekly Summary
│   ├── Create Worklog
│   └── Update Worklog
│
├── Tool Usage
│   ├── Đọc dữ liệu trước
│   ├── Validate trước khi ghi
│   └── Xác minh sau khi ghi
│
└── Error Handling
    ├── API Error
    ├── Ambiguous Issue
    ├── Duplicate Worklog
    └── Missing Duration
```

## Skill và MCP phải thống nhất hợp đồng

Ví dụ: nếu Skill hướng dẫn AI gọi `tempo_create_worklog`, thì MCP Server phải thực sự đăng ký tool đó với schema tương thích.

Nên có một tài liệu tham chiếu liệt kê tên tools, tham số và hành vi. Khi thay đổi tools, hãy cập nhật tài liệu và kiểm thử để tránh Skill sử dụng tên hoặc tham số đã lỗi thời.

## Commands dành cho OpenCode

Ví dụ:

```text
/tempo-today
/tempo-week
/tempo-log SP0168-3839 1h30m
```

Commands là lớp tiện ích, không phải nơi chứa logic nghiệp vụ. Mỗi command nên yêu cầu agent sử dụng Skill phù hợp và gọi MCP tools theo đúng quy trình.

> **Lưu ý:** Đường dẫn `.opencode/command/` ở trên là một ví dụ cần xác nhận theo phiên bản OpenCode; tên thư mục, frontmatter và cách truyền tham số phải tuân theo tài liệu của phiên bản bạn cài.
