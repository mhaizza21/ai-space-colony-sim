---
title: "Risks and Technical Debt"
type: "risks"
status: "active"
source_paths:
  - "docs/architecture-readiness-report.md"
  - "docs/README.md"
  - "ai-studio/SYSTEM_MAP.md"
  - "design/README.md"
  - "ai-studio/workflows/kanban-update-protocol.md"
last_verified: "2026-07-29"
---

# ความเสี่ยงและหนี้ทางเทคนิค

## ความเสี่ยงที่มีหลักฐานรองรับ

| ความเสี่ยง | แหล่งหลักฐาน | วิธีควบคุม | สถานะ |
|---|---|---|---|
| ข้อมูล Kanban ออนไลน์ไม่ถูกตรวจในเครื่อง | คำยืนยันของ project owner และข้อจำกัดของงาน | ไม่สร้างหรือคาดเดาหมายเลข card | Needs verification |
| ADR-19 ไม่มีไฟล์ใน `ai-studio/adr/` | `docs/architecture-readiness-report.md` และการตรวจรายการไฟล์ | ห้ามอนุมานสถานะหรือเนื้อหา ADR-19 | Unknown |
| เอกสารที่ `docs/README.md` คาดหวังยังไม่ใช่แหล่งข้อมูลของ Vault นี้ | `docs/README.md` | ให้เจ้าของโครงการกำหนด card และขอบเขตแยกต่างหาก | Active |
| ข้อมูล snapshot ใน readiness report อาจล้าสมัย | `docs/architecture-readiness-report.md` | ตรวจ repository ใหม่ก่อนนำสถานะ snapshot ไปใช้ | Active |
| tests และ typecheck ไม่ได้รันในงานนี้ | ขอบเขตที่ได้รับอนุมัติ | ระบุ Needs verification โดยไม่ใช้คำว่า verified | Needs verification |
| Crisis มีชนิด Memory แต่รายงานระบุว่ายังไม่มี crisis system | `docs/architecture-readiness-report.md` | ไม่อ้างว่ามีพฤติกรรม crisis ที่ทำงานแล้ว | Active |

## ขอบเขตหนี้ทางเทคนิค

- ห้ามเพิ่มช่องทาง command จากผู้เล่นสู่ colonist เพราะขัดกับ Conditions, Not Commands และสถาปัตยกรรมที่ยอมรับแล้ว
- การเพิ่ม need, social action, persisted union หรือ save format ต้องผ่าน ADR ที่เหมาะสม
- โค้ดและเอกสารที่ไม่ตรงกันเป็น defect หรือการตัดสินใจที่ยังไม่บันทึก ไม่ใช่หลักฐานให้นำ implementation มาเป็นอำนาจเหนือเอกสาร
- สถานะจากรายงานวันที่ 2026-07-17 ต้องไม่ถูกนำเสนอเป็นสถานะปัจจุบันโดยไม่ตรวจซ้ำ

## เกณฑ์หยุดงาน

เมื่อพบความขัดแย้ง การขยายขอบเขต dependency ที่ยังไม่พร้อม หรือ architecture trigger ใหม่ ให้หยุด รายงาน blocker และเปิดกระบวนการ design หรือ ADR ที่จำเป็นแทนการแก้ไขโดยคาดเดา

ติดตามรายการที่ยังเปิดอยู่ใน [[09-Open-Questions]] และสถานะการตรวจใน [[02-Current-Status]]
