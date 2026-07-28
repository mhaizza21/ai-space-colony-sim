---
title: "Architecture"
type: "architecture"
status: "active"
source_paths:
  - "design/phase-2-architecture-freeze.md"
  - "design/engineering-specification.md"
  - "docs/architecture-readiness-report.md"
  - "ai-studio/constitution/architecture-philosophy.md"
  - "ai-studio/SYSTEM_MAP.md"
  - "prototype/tsconfig.json"
  - "prototype/package.json"
last_verified: "2026-07-29"
---

# สถาปัตยกรรม

## ลำดับแหล่งอำนาจ

Constitution → Governance → Accepted ADRs → Design specifications → Workflow → Implementation

Implementation ต้องสอดคล้องกับแหล่งอำนาจที่อยู่ก่อนหน้า และการเปลี่ยนขอบเขตระบบ data model save format serialization หรือ interface ระหว่างระบบต้องมี ADR ก่อนเริ่มดำเนินการ

## ขอบเขตหลัก

- `prototype/` เป็นโค้ดที่รันได้จริงของการจำลองแบบ headless
- simulation ไม่ขึ้นกับ UI rendering frame timing หรือ DOM
- UI ไม่เป็นเจ้าของ authoritative state
- agent อ่าน world state ผ่าน snapshot ที่คงที่และไม่ถือ live reference ไปยังสถานะภายในของ agent อื่น
- ระบบแต่ละส่วนมีเจ้าของข้อมูลเพียงรายเดียวและสื่อสารผ่าน interface ที่กำหนด
- สถานะการจำลองต้อง serialize และคืนค่าผ่าน save/load ได้โดยไม่สูญเสียความหมาย

## หลักประกันที่เอกสารต้นทางยืนยัน

- M4 Snapshot เป็นเส้นทางเดียวจาก world state ไปสู่การตัดสินใจ
- การรับรู้ข้าม colonist จำกัดที่ Tier-1 perception
- tick ใช้ลำดับเจ็ดช่วงที่ตายตัวและมีลำดับภายในช่วงที่เสถียร
- ความสุ่มของ simulation ต้องผ่าน seeded PRNG ของ S1
- load ต้องตรวจสอบข้อมูลและไม่ซ่อมข้อมูลเงียบ ๆ
- การตัดสินใจสำคัญต้องแยกองค์ประกอบและบันทึกเพื่ออธิบายย้อนหลังได้
- Memory และ event log เป็นคนละระบบ
- ไม่มีช่องทางสั่งตรงจากผู้เล่นไปยัง colonist หรือจาก colonist ไปยัง colonist

## จุดเข้า runtime

`prototype/src/main.ts` ส่งออก `runCli(argv)` ซึ่งรับคำสั่ง `run`, `continue` และ `verify` แล้วคืนค่าเป็น JSON string โมดูลนี้ไม่มี file-system หรือ console I/O; process wrapper ภายนอกเป็นผู้รับผิดชอบการพิมพ์และการอ่านเขียนไฟล์

## แหล่งอ้างอิงเชิงลึก

- ขอบเขตโมดูลและ interface: `design/engineering-specification.md` §1–§4
- ลำดับ tick: `design/engineering-specification.md` §5
- save/load: `design/engineering-specification.md` §7
- determinism: `design/engineering-specification.md` §8
- การตัดสินใจที่ตรึงไว้: `design/phase-2-architecture-freeze.md`

ดูแผนภาพที่ [[Maps/architecture-system-context]] และตารางอ้างอิงที่ [[Maps/dependency-matrix]]
