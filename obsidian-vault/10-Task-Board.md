---
title: "กระดานงาน Vault"
type: "task-board"
status: "active"
source_paths:
  - "ai-studio/workflows/kanban-update-protocol.md"
  - "docs/ai-workflow/operating-model.md"
  - "docs/ai-workflow/done-update-template.md"
last_verified: "2026-07-29"
---

# กระดานงาน Vault

## สถานะอำนาจของงาน

Existing Kanban card confirmed by project owner; online metadata not locally verified.

- ไม่สร้างหรือคาดเดาหมายเลข card
- ไม่โพสต์ Start Task หรือ Kanban Update ออนไลน์
- ขอบเขตที่อนุมัติจำกัดอยู่ใน `obsidian-vault/`
- branch ที่ใช้ทำงานคือ `docs/obsidian-knowledge-base`
- base snapshot/HEAD คือ `0f9e098`

## ขอบเขตงานที่อนุมัติ

| งาน | จำนวน | สถานะ |
|---|---:|---|
| ซ่อมไฟล์เดิม | 10 | เสร็จแล้ว |
| สร้างไฟล์ที่ขาด | 5 | เสร็จแล้ว |
| ตรวจ YAML frontmatter | 15 | ผ่าน |
| ตรวจ wikilinks | 15 | ผ่าน |
| ตรวจ `source_paths` | 15 | ผ่าน |
| ตรวจอักษรและข้อความเพี้ยน | 15 | ผ่าน |
| tests และ build | 0 | Needs verification ตามข้อห้ามของงาน |

## สถานะมาตรฐานของโครงการ

Backlog → Ready → In Progress → Review → Testing → Done

Blocked ใช้เมื่อ dependency ขาดหาย มีความขัดแย้ง หรือจำเป็นต้องตัดสินใจก่อนทำงานต่อ งานปัจจุบันจะหยุดที่ review-ready และไม่มีการ merge, commit หรือ push

## ขอบเขตที่ไม่ทำ

- ไม่แก้ไฟล์นอก `obsidian-vault/`
- ไม่แตะไดเรกทอรีที่ project owner ระบุให้เว้น
- ไม่ลบไฟล์
- ไม่สลับ branch
- ไม่รัน tests หรือ build
- ไม่โพสต์ข้อมูล Kanban ออนไลน์

## ทางเชื่อม

- สถานะ repository: [[02-Current-Status]]
- ขั้นตอนทำงาน: [[06-Development-Workflow]]
- ความเสี่ยง: [[08-Risks-and-Technical-Debt]]
- คำถามที่ยังเปิด: [[09-Open-Questions]]
