---
title: "แผนภาพบริบทสถาปัตยกรรม"
type: "map"
status: "active"
source_paths:
  - "ai-studio/constitution/architecture-philosophy.md"
  - "design/engineering-specification.md"
  - "docs/architecture-readiness-report.md"
last_verified: "2026-07-29"
---

# แผนภาพบริบทสถาปัตยกรรม

แผนภาพนี้แสดงเฉพาะขอบเขตที่เอกสารต้นทางยืนยัน ได้แก่ ผู้เล่นส่ง input เข้าสู่ simulation, M4 Snapshot เป็นทางอ่าน world state สำหรับการตัดสินใจ, ระบบใช้ S1 เป็นแหล่งความสุ่ม และผลที่คงอยู่ผ่าน records กับ serialization

```mermaid
flowchart LR
    Player[Player] -->|input และ policy| Simulation[Headless Simulation]
    Simulation --> World[World State]
    World --> Snapshot[M4 Snapshot]
    Snapshot --> Decision[Agent Decision]
    S1[S1 Seeded PRNG] --> Decision
    Decision --> Execution[Task Execution]
    Execution --> Simulation
    Simulation --> Records[S2 Records]
    Simulation --> Serialization[S3 Serialization]
    Serialization --> Save[Versioned Save]
    Simulation --> Inspection[Inspection และ Replay]
```

## ขอบเขตที่ต้องรักษา

- UI ไม่เป็นเจ้าของ authoritative state
- Agent ไม่อ่านสถานะภายในของ Agent อื่นผ่าน live reference
- ความสุ่มทั้งหมดของ simulation ผ่าน S1
- load ตรวจข้อมูลและไม่ซ่อมข้อมูลเงียบ ๆ
- การตัดสินใจสำคัญต้องตรวจสอบย้อนหลังได้

กลับไปที่ [[03-Architecture]] หรือดูความสัมพันธ์เอกสารใน [[Maps/dependency-matrix]]
