---
title: "Decisions and ADRs"
type: "decisions"
status: "active"
source_paths:
  - "ai-studio/adr/README.md"
  - "ai-studio/adr/0017-need-system-architecture.md"
  - "ai-studio/adr/0018-social-action-space.md"
  - "ai-studio/adr/0020-relationship-record-storage.md"
  - "ai-studio/adr/0021-social-offer-state-storage.md"
  - "ai-studio/adr/0022-per-colonist-runtime-collection.md"
  - "ai-studio/adr/0023-mission-control-projection-and-control-boundary.md"
  - "ai-studio/adr/0024-comfort-offer-action-and-save-format-v7.md"
  - "ai-studio/governance/ownership.md"
last_verified: "2026-07-29"
---

# การตัดสินใจและ ADR

## ดัชนีสถานะ

| รายการ | ชื่อ | สถานะ | แหล่งข้อมูล |
|---|---|---|---|
| ADR-01–16 | ชุดการตัดสินใจสถาปัตยกรรมระยะต้น | Accepted | `design/architecture-decision-set.md` |
| ADR-17 | Need System Architecture | Accepted | `ai-studio/adr/0017-need-system-architecture.md` |
| ADR-18 | Social Action Space | Accepted | `ai-studio/adr/0018-social-action-space.md` |
| ADR-20 | Relationship Record Storage | Accepted | `ai-studio/adr/0020-relationship-record-storage.md` |
| ADR-21 | Social Offer State Storage | Accepted และแก้ไขบางส่วนโดย ADR-24 | `ai-studio/adr/0021-social-offer-state-storage.md` |
| ADR-22 | Per-Colonist Runtime Collection | Accepted | `ai-studio/adr/0022-per-colonist-runtime-collection.md` |
| ADR-23 | Mission Control Projection and Control Boundary | Accepted | `ai-studio/adr/0023-mission-control-projection-and-control-boundary.md` |
| ADR-24 | Comfort Offer Action and Save Format v7 | Accepted | `ai-studio/adr/0024-comfort-offer-action-and-save-format-v7.md` |
| ADR-19 | Colonist Arrival System | Unknown | ไม่พบไฟล์ ADR-19 ใน `ai-studio/adr/` ณ 2026-07-29 |

## ข้อกำหนดสำคัญ

- Accepted ADR เป็นบันทึกแบบ immutable; หากต้องเปลี่ยนการตัดสินใจให้สร้าง ADR ใหม่ที่อ้างถึงรายการเดิม
- ห้ามเปิดการตัดสินใจที่ยอมรับแล้วขึ้นพิจารณาใหม่โดยไม่มี ADR ที่แทนที่หรือแก้ไขอย่างเป็นทางการ
- หมายเลข ADR ใช้ตามลำดับและห้ามนำกลับมาใช้ซ้ำ
- ผู้เขียนเป็นเจ้าของ ADR แต่ Human Collaborator เป็นผู้อนุมัติขั้นสุดท้ายสำหรับ Tier 3–4

## ข้อสรุปที่เกี่ยวข้องกับ runtime ปัจจุบัน

- ADR-17 ปิด taxonomy ของ needs ไว้ห้ารายการ ได้แก่ Hunger, Rest, Safety, Social และ Purpose
- ADR-18 กำหนดพื้นที่ social action แบบปิดและยืนยันว่า Confrontation ไม่ใช่ goal
- ADR-20 ให้ M10 เป็นเจ้าของ relationship record แบบรวมศูนย์ต่อคู่ colonist พร้อมมุมมองแบบมีทิศทาง
- ADR-21 ให้ M12 เป็นเจ้าของ `SimulationState.socialOffers`
- ADR-22 ให้ `SimulationState.colonists` เป็น collection หลักที่เรียงตาม colonist id
- ADR-24 เพิ่ม Comfort ใน `SocialOfferAction` และใช้ save format v7 แต่ไม่เพิ่ม Assist

อ่านภาพรวมสถาปัตยกรรมที่ [[03-Architecture]] และความสัมพันธ์กับโค้ดที่ [[05-Systems-and-Modules]]
