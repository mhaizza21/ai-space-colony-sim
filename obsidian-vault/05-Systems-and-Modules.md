---
title: "Systems and Modules"
type: "systems"
status: "active"
source_paths:
  - "prototype/package.json"
  - "prototype/tsconfig.json"
  - "prototype/src/main.ts"
  - "design/architecture-decision-set.md"
  - "design/architecture-freeze-report.md"
  - "docs/architecture-readiness-report.md"
last_verified: "2026-07-29"
---

# ระบบและโมดูล

## ข้อเท็จจริงของ runtime

- โค้ดที่รันได้จริงอยู่ใน `prototype/`
- `prototype/src/main.ts` ส่งออก `runCli(argv)` และคืนค่าเป็น JSON string
- `prototype/package.json` ระบุ TypeScript และ Vitest เป็น `devDependencies`
- `prototype/tsconfig.json` เปิด `strict`, `noUncheckedIndexedAccess` และ `noImplicitOverride`
- ไม่พบ runtime dependency ใน `prototype/package.json`

## โครงสร้างตามข้อกำหนดสถาปัตยกรรม

`design/engineering-specification.md` ระบุโมดูล M1–M12 บริการ S1–S3 และ interface แบบมีทิศทาง 14 รายการ ระบบใช้เจ้าของข้อมูลรายเดียวและลำดับ tick เจ็ดช่วง ได้แก่ เวลา โลก สถานะต่อเนื่องของ colonist การตรวจ trigger การตัดสินใจ การดำเนินการและผลตามมา และการบันทึก

## กลุ่มไฟล์ใน `prototype/src`

| กลุ่ม | หน้าที่หลัก |
|---|---|
| `colonist/` | ตัวตน needs traits stress memory และ relationships |
| `core/` | clock seeded PRNG และ serialization |
| `decision/` | การตัดสินใจ goals และ weights |
| `inspection/` | สรุปสถานะสำหรับตรวจสอบ |
| `records/` | บันทึกเหตุการณ์และการตัดสินใจ |
| `replay/` | ตรวจความสอดคล้องของ replay |
| `simulation/` | สร้างสถานะ เรียก run ประมวลผล tick และ Comfort participation |
| `task/` | tasks social offers และ execution |
| `world/` | world policy และ snapshot |
| `config/` | constants และ tuning |

## คำสั่ง CLI

- `run --seed N --ticks N`
- `continue --save <json> --ticks N`
- `verify --seed N --save <json>`

## ความสัมพันธ์ระหว่างเอกสารกับโค้ด

| ประเด็น | แหล่งอำนาจ | ตำแหน่งโค้ด |
|---|---|---|
| serialization และ save format | ADR-20, ADR-22, ADR-24 และ `design/engineering-specification.md` §7 | `prototype/src/core/serialization.ts` |
| tick และ determinism | `design/engineering-specification.md` §5 และ §8 | `prototype/src/simulation/run.ts`, `prototype/src/simulation/tick.ts` |
| social offer | ADR-21 และ ADR-24 | `prototype/src/task/socialOffers.ts`, `prototype/src/task/execution.ts` |
| per-colonist runtime | ADR-22 | `prototype/src/simulation/run.ts`, `prototype/src/decision/decide.ts` |
| Comfort participation | ADR-24 | `prototype/src/simulation/comfortParticipation.ts`, `prototype/src/task/execution.ts` |

ผล tests และ typecheck ของ snapshot นี้ยังเป็น Needs verification เพราะงาน Vault ไม่ได้รับอนุญาตให้รันคำสั่งเหล่านั้น ดู [[02-Current-Status]] และ [[Maps/dependency-matrix]]
