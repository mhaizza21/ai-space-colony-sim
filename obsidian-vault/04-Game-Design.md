---
title: "Game Design"
type: "design"
status: "active"
source_paths:
  - "design/game-pillars.md"
  - "design/core-loop.md"
  - "design/vision.md"
  - "ai-studio/constitution/vision.md"
  - "design/player-fantasy.md"
  - "design/player-journey.md"
  - "design/gameplay-phases.md"
  - "design/goal-system.md"
  - "design/needs-system.md"
  - "design/personality-traits.md"
  - "design/memory-system.md"
  - "design/decision-loop.md"
  - "design/autonomous-three-colonist-runtime.md"
  - "design/comfort-assist-protocol.md"
  - "design/social-offer-response-protocol.md"
  - "design/colonist-agent-model.md"
  - "design/colony-life.md"
  - "design/README.md"
last_verified: "2026-07-29"
---

# การออกแบบเกม

## วิสัยทัศน์

colonist เป็น AI agent อิสระ ส่วนผู้เล่นเป็นผู้ออกแบบอาณานิคมและผู้จัดการวิกฤต ผู้เล่นสร้างเงื่อนไขและนโยบาย แล้วสังเกตผลที่เกิดจากการตัดสินใจ ความสัมพันธ์ และแรงกดดันด้านทรัพยากรของ agent เรื่องราวจึงเกิดจากระบบจริงแทนการกำหนดเหตุการณ์ล่วงหน้า

## วงจรการเล่นหลายช่วงเวลา

| ช่วงเวลา | วงจร | เป้าหมายของผู้เล่น |
|---|---|---|
| ประมาณ 30 วินาที | Reading the Room | อ่านสัญญาณของอาณานิคมและตัดสินใจว่าจะรอหรือแทรกแซงผ่านเงื่อนไข |
| ประมาณ 5 นาที | The Decision | ปรับนโยบาย ทรัพยากร หรือสภาพแวดล้อม |
| ประมาณ 30 นาที | Watching Consequences Unfold | ติดตามผลต่อเนื่องและปรับความเข้าใจจากสิ่งที่เกิดขึ้น |
| หลายชั่วโมง | The Story Arc | รับมือการสะสมแรงตึงเครียด วิกฤต และผลภายหลัง |
| ระยะยาว | Culture and Calcification | สังเกตวัฒนธรรมและรูปแบบที่ฝังตัวในอาณานิคม |

## ระบบสำคัญ

| ระบบ | แหล่งออกแบบ | อำนาจที่เกี่ยวข้อง |
|---|---|---|
| Needs | `design/needs-system.md` | ADR-17 กำหนด taxonomy แบบปิด |
| Personality Traits | `design/personality-traits.md` | trait ปรับน้ำหนักแต่ไม่เป็นคำสั่งห้ามเด็ดขาด |
| Goal System | `design/goal-system.md` | เป้าหมายมีวงจรชีวิตและขับเคลื่อนงานที่ทำได้ |
| Memory | `design/memory-system.md` | Memory แยกจาก event log |
| Decision Loop | `design/decision-loop.md` | การตัดสินใจต้องอธิบายและทำซ้ำได้ |
| Autonomous Runtime | `design/autonomous-three-colonist-runtime.md` | ใช้ collection ของ colonist ที่เรียงลำดับแน่นอน |
| Social Offer | `design/social-offer-response-protocol.md` | ADR-18, ADR-20, ADR-21 และ ADR-22 |
| Comfort | `design/comfort-assist-protocol.md` | ADR-24 อนุญาต Comfort แต่ยังไม่อนุญาต Assist ในขอบเขตเดียวกัน |

## ขอบเขตการออกแบบ

- ผู้เล่นไม่มีช่องทางสั่ง colonist โดยตรง
- พฤติกรรมต้องเกิดจาก candidate น้ำหนัก สถานะโลก และสถานะของ agent
- protocol ใหม่ที่เปลี่ยน data model save format serialization หรือขอบเขตระบบต้องผ่าน ADR ก่อน implementation
- ข้อมูลเชิงสถานะที่เปลี่ยนตามเวลาให้ตรวจที่ [[02-Current-Status]] แทนการอนุมานจากเอกสารออกแบบ

ดูคำศัพท์ที่ [[Glossary]] และบริบทระบบที่ [[03-Architecture]]
