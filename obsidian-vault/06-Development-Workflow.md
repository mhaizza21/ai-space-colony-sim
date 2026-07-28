---
title: "Development Workflow"
type: "workflow"
status: "active"
source_paths:
  - "ai-studio/AI_STUDIO_BOOT.md"
  - "ai-studio/SYSTEM_MAP.md"
  - "ai-studio/workflows/kanban-update-protocol.md"
  - "docs/ai-workflow/README.md"
  - "docs/ai-workflow/operating-model.md"
  - "docs/ai-workflow/prompt-pack.md"
  - "CONTRIBUTING.md"
last_verified: "2026-07-29"
---

# ขั้นตอนการพัฒนา

## ลำดับเริ่มงานที่บังคับใช้

1. อ่าน `ai-studio/AI_STUDIO_BOOT.md`
2. อ่าน `ai-studio/SYSTEM_MAP.md`
3. อ่านเอกสารทั้งห้าไฟล์ใน `ai-studio/constitution/`
4. อ่าน `ownership.md`, `change-management.md` และ `versioning.md`
5. อ่าน workflow ที่ตรงกับงาน
6. อ่าน `ai-studio/workflows/kanban-update-protocol.md`
7. โหลดบทบาทที่ได้รับมอบหมาย
8. อ่าน Accepted ADRs ที่เกี่ยวข้อง
9. อ่าน Kanban card และ issue แล้วจัดทำ Start Task ก่อนแก้ไฟล์

## กฎหลัก

- No Card, No Work — ห้ามเริ่มงานที่ไม่มี card รองรับ
- No Kanban Update, Task Not Done — งานยังไม่เสร็จจนกว่าจะมี Kanban Update
- Authority First — ต้องระบุ issue/card, design, ADR, merged PR และ workflow ที่ให้อำนาจแก่งาน
- No Silent Scope Expansion — หากต้องขยายขอบเขตให้หยุดและยกระดับปัญหา
- Review Before Merge — ต้องผ่านการตรวจทานก่อน merge

## สถานะมาตรฐาน

Backlog → Ready → In Progress → Review → Testing → Done

หากมี dependency ขาดหาย ความขัดแย้ง หรือการตัดสินใจที่ยังไม่เกิดขึ้น ให้ใช้สถานะ Blocked และจัดทำ Blocker Report

## บทบาท

| บทบาท | ความรับผิดชอบ |
|---|---|
| Planner | จัดทำ card หรือขอบเขตย่อยถัดไปเพียงรายการเดียว |
| Implementer | ทำตามขอบเขตที่อนุมัติและหยุดที่ review-ready |
| Reviewer | รายงาน findings ก่อนสรุปและให้ผล Approved หรือ Revisions Required |
| Workflow Operator | บันทึก approval, merge และปิดงานหลังผ่าน gate |
| Human Owner | เป็นอำนาจอนุมัติขั้นสุดท้ายตามที่ governance กำหนด |

## เอกสารปิดงาน

Decision Log ต้องมาก่อน Kanban Update และ Kanban Update ต้องระบุ Card, Status, Completed, Changed Files, Validation และ Follow-up Tasks ให้ครบ ความคิดเห็น workflow ที่อยู่ภายใต้ schema ต้องมี marker `ai-workflow-record:v1` เพียงหนึ่งรายการ

Existing Kanban card confirmed by project owner; online metadata not locally verified. งาน Vault นี้จึงไม่สร้างหรือเดาหมายเลข card และจะให้ข้อความ Kanban completion update ใน Completion Report เท่านั้นโดยไม่โพสต์ออนไลน์

ดูสถานะงานที่ [[10-Task-Board]] และลำดับอำนาจที่ [[Maps/directory-authority-map]]
