---
title: "Open Questions"
type: "open-questions"
status: "active"
source_paths:
  - "ai-studio/SYSTEM_MAP.md"
  - "docs/README.md"
  - "docs/architecture-readiness-report.md"
  - "ai-studio/workflows/kanban-update-protocol.md"
last_verified: "2026-07-29"
---

# คำถามที่ยังเปิดอยู่

## กฎการบันทึก

เรื่องที่ไม่มีหลักฐานหรือ approval ต้องระบุ Unknown หรือ Needs verification ห้ามเดาข้อมูล ห้ามสร้างหมายเลข card และห้ามเปลี่ยนข้อสันนิษฐานให้เป็นข้อเท็จจริง

## Kanban และ workflow

- Existing Kanban card confirmed by project owner; online metadata not locally verified.
- ชื่อ หมายเลข สถานะออนไลน์ ผู้รับผิดชอบ และ metadata อื่นของ card ยังเป็น Needs verification
- งานนี้ได้รับอนุมัติเฉพาะการซ่อมและสร้างไฟล์ใน `obsidian-vault/` จึงไม่มีการโพสต์ Start Task หรือ Kanban Update ออนไลน์

## เอกสารที่ `docs/README.md` คาดหวัง

รายการต่อไปนี้ปรากฏในตาราง Files expected แต่ไม่ได้เป็น `source_paths` ที่มีอยู่ของ Vault รอบนี้

- `docs/roadmap.md`
- `docs/kanban-rules.md`
- `docs/definition-of-done.md`
- `docs/onboarding.md`
- `docs/workflow.md`

การสร้างเอกสารเหล่านี้ต้องมี card และขอบเขตแยกต่างหาก

## ADR และสถาปัตยกรรม

- ADR-19 Colonist Arrival System ถูกกล่าวถึงใน `design/engineering-specification.md` แต่ไม่พบไฟล์ ADR-19 ใน `ai-studio/adr/` ณ 2026-07-29 จึงมีสถานะ Unknown
- การตัดสินใจใหม่ที่กระทบ data model save format serialization หรือ interface ต้องผ่าน architecture gate ก่อน implementation

## การตรวจทางเทคนิค

- ผล `npm --prefix prototype test`: Needs verification
- ผล `npm exec --prefix prototype -- tsc --noEmit -p prototype/tsconfig.json`: Needs verification
- จำนวน tests ที่ผ่านใน snapshot นี้: Needs verification

## ผู้มีอำนาจตอบ

| เรื่อง | ผู้มีอำนาจหรือแหล่งตรวจ |
|---|---|
| metadata ของ Kanban card | project owner และ Kanban ออนไลน์ |
| การมีอยู่และสถานะของ ADR-19 | repository และกระบวนการ ADR |
| การสร้างเอกสารใน `docs/` ที่ยังขาด | card ที่ได้รับอนุมัติจาก Human Owner |
| ผล tests และ typecheck | การรันคำสั่งในงานที่อนุญาตให้ตรวจทางเทคนิค |

ดูความเสี่ยงที่ [[08-Risks-and-Technical-Debt]] และสถานะปัจจุบันที่ [[02-Current-Status]]
