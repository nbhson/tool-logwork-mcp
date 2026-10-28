# Cấu trúc thư mục

```text
tempo-mcp/
│
├── src/
│   ├── index.ts
│   │
│   ├── config/
│   │   ├── env.ts
│   │   └── constants.ts
│   │
│   ├── clients/
│   │   ├── tempo-client.ts
│   │   └── jira-client.ts
│   │
│   ├── tools/
│   │   ├── tempo/
│   │   │   ├── get-worklogs.ts
│   │   │   ├── get-worklog.ts
│   │   │   ├── preview-worklog.ts
│   │   │   ├── create-worklog.ts
│   │   │   └── update-worklog.ts
│   │   │
│   │   ├── jira/
│   │   │   └── search-issues.ts
│   │   │
│   │   └── reports/
│   │       └── weekly-summary.ts
│   │
│   ├── services/
│   │   ├── worklog-service.ts
│   │   ├── validation-service.ts
│   │   ├── duplicate-service.ts
│   │   └── report-service.ts
│   │
│   ├── schemas/
│   │   ├── worklog.schema.ts
│   │   └── issue.schema.ts
│   │
│   └── utils/
│       ├── date.ts
│       ├── duration.ts
│       └── errors.ts
│
├── skills/
│   └── tempo-timesheet/
│       └── SKILL.md
│
├── .opencode/
│   └── command/
│       ├── tempo-today.md
│       ├── tempo-week.md
│       └── tempo-log.md
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── docs/
│   ├── architecture.md
│   ├── workflows.md
│   ├── api-reference.md
│   ├── security.md
│   └── setup-opencode.md
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

## Trách nhiệm của từng lớp

| Lớp                  | Trách nhiệm                                 | Có gọi API trực tiếp?      |
| -------------------- | ------------------------------------------- | -------------------------- |
| `tools/`             | Định nghĩa các MCP tools, schema và kết quả | Không nên chứa logic HTTP  |
| `services/`          | Xử lý nghiệp vụ, validation, kiểm tra trùng | Gọi API thông qua clients  |
| `clients/`           | Xác thực, HTTP request, timeout, retry      | Có                         |
| `schemas/`           | Kiểm tra cấu trúc dữ liệu                   | Không                      |
| `skills/`            | Hướng dẫn AI cách sử dụng tools             | Không                      |
| `.opencode/command/` | Định nghĩa các lệnh nhanh                   | Không                      |
| `tests/`             | Kiểm thử logic và tích hợp                  | Có trong integration tests |

## Nguyên tắc

Mỗi lớp có một trách nhiệm rõ ràng. Không để Skill tự xử lý API và không để MCP tool chứa toàn bộ logic nghiệp vụ.
