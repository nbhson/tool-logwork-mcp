# Kiến trúc hệ thống

Hệ thống gồm 5 lớp chính:

1. **AI Client Layer** — OpenCode hoặc MCP client khác.
2. **AI Guidance Layer** — Skill và Commands hướng dẫn cách thực hiện công việc.
3. **MCP Server Layer** — Cung cấp các tools cho AI agent.
4. **Business Logic Layer** — Validation, kiểm tra trùng lặp và quản lý quy trình.
5. **Integration Layer** — Kết nối Tempo REST API và Jira REST API.

## Luồng tổng quát

```mermaid
flowchart TB
    USER["User"]

    subgraph CLIENT["1. AI Client Layer"]
        OC["OpenCode"]
        OTHER["Other MCP Clients"]
    end

    subgraph GUIDANCE["2. AI Guidance Layer"]
        SKILL["Tempo Timesheet Skill"]
        CMD["Commands<br/>/tempo-today<br/>/tempo-week<br/>/tempo-log"]
    end

    subgraph MCP["3. MCP Server Layer"]
        TOOLS["MCP Tools"]
        SCHEMA["Input Schema Validation"]
    end

    subgraph BUSINESS["4. Business Logic Layer"]
        SERVICE["Worklog Service"]
        VALIDATE["Business Validation"]
        DEDUP["Duplicate Detection"]
        APPROVAL["Approval / Confirmation"]
    end

    subgraph INTEGRATION["5. Integration Layer"]
        TEMPO["Tempo REST API"]
        JIRA["Jira REST API"]
    end

    USER --> OC
    USER --> OTHER

    OC --> SKILL
    OC --> CMD
    OTHER --> TOOLS

    SKILL --> TOOLS
    CMD --> SKILL

    TOOLS --> SCHEMA
    SCHEMA --> SERVICE

    SERVICE --> JIRA
    SERVICE --> TEMPO
    SERVICE --> VALIDATE
    VALIDATE --> DEDUP
    DEDUP --> APPROVAL

    APPROVAL --> SERVICE
    SERVICE --> TEMPO
```

## Lưu ý về triển khai

Đây là kiến trúc logic. Trong thực tế:

- Skill và Commands không trực tiếp gọi API; chúng hướng dẫn AI agent gọi MCP tools.
- Với MCP qua stdio, server thường chạy như một tiến trình con của client.
- Việc xác nhận thao tác ghi cần được thực thi trong đúng luồng tương tác của client, thay vì giả định rằng một hộp thoại xác nhận sẽ tự xuất hiện từ MCP Server.
