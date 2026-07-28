---
title: "แผนภาพอำนาจของไดเรกทอรี"
type: "map"
status: "active"
source_paths:
  - "ai-studio/SYSTEM_MAP.md"
  - "ai-studio/governance/ownership.md"
  - "ai-studio/governance/change-management.md"
last_verified: "2026-07-29"
---

# แผนภาพอำนาจของไดเรกทอรี

```mermaid
flowchart TD
    Human[Human Collaborator] -->|อนุมัติขั้นสุดท้าย Tier 3–4| Constitution[ai-studio/constitution]
    Human -->|อนุมัติขั้นสุดท้าย| Governance[ai-studio/governance]
    Human -->|อนุมัติตาม gate| ADR[ai-studio/adr]
    Technical[Technical Director] --> Governance
    Technical --> Workflow[ai-studio/workflows และ docs]
    Creative[Creative Director] --> Game[game]
    Designer[Game Systems Designer] --> Design[design]
    QA[QA Reviewer] --> Reviews[ai-studio/reviews]
    Constitution --> ADR
    Governance --> ADR
    ADR --> Design
    Design --> Prototype[prototype]
```

## ตารางเจ้าของ

| ชุดเอกสาร | เจ้าของหลัก | ผู้อนุมัติขั้นสุดท้ายเมื่อกำหนด |
|---|---|---|
| `ai-studio/constitution/` | Creative Director และ Technical Director ตามไฟล์ | Human Collaborator |
| `ai-studio/governance/` | Technical Director | Human Collaborator |
| `ai-studio/workflows/` | Technical Director | Human Collaborator |
| `ai-studio/adr/` | ผู้เขียน ADR | Human Collaborator |
| `design/` | Game Systems Designer | Human Collaborator |
| `docs/` | Technical Director | Human Collaborator |
| `game/` | Creative Director | Human Collaborator |
| `ai-studio/reviews/` | QA Reviewer | เป็นบันทึก ไม่ใช่การตัดสินใจ |

Ownership ไม่ได้ห้ามผู้อื่นเสนอการแก้ไข แต่กำหนดผู้รับผิดชอบคุณภาพและผู้มีอำนาจอนุมัติ ดู workflow ที่ [[06-Development-Workflow]] และภาพรวมที่ [[01-Project-Overview]]
