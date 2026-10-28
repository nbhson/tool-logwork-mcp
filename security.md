# Security Architecture — Bảo mật và kiểm soát dữ liệu

Vì MCP này có quyền ghi timesheet của công ty, hệ thống nên được triển khai theo nguyên tắc: **Read by default, Write with approval**.

## Luồng xử lý bảo mật

```mermaid
flowchart TD
    A["AI Agent"]
    B["MCP Tool Request"]
    C["Validate Input Schema"]
    D["Check Authentication and Permissions"]
    E["Check Business Rules"]
    F["Read / Preview Result"]
    G{"Write Operation?"}
    H["Return Read Result"]
    I["Request User Approval"]
    J{"Approved?"}
    K["Reject Operation"]
    L["Execute Tempo API"]
    M["Verify Result"]
    N["Audit Outcome"]

    A --> B --> C --> D --> E
    E --> F --> G
    G -- No --> H
    G -- Yes --> I --> J
    J -- No --> K
    J -- Yes --> L --> M --> N
    H --> N
    K --> N
```

## Các lớp bảo vệ cần có

| Lớp                 | Yêu cầu                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| Authentication      | Sử dụng Tempo API token hợp lệ                                            |
| Authorization       | Chỉ thao tác trong phạm vi quyền được cấp                                 |
| Input validation    | Kiểm tra issue key, ngày, thời lượng và mô tả                             |
| Duplicate detection | Cảnh báo worklog có khả năng trùng                                        |
| Approval            | Yêu cầu xác nhận trước khi ghi                                            |
| Audit               | Ghi lại thao tác thành công hoặc thất bại, không ghi token                |
| Error handling      | Không tự động gửi lại thao tác ghi khi chưa xác định được kết quả lần đầu |
