---
title: "อภิธานศัพท์"
type: "glossary"
status: "active"
source_paths:
  - "ai-studio/constitution/glossary.md"
  - "ai-studio/constitution/principles.md"
  - "ai-studio/workflows/kanban-update-protocol.md"
last_verified: "2026-07-29"
---

# อภิธานศัพท์

## คำศัพท์ของ simulation

| คำ | ความหมาย |
|---|---|
| Agent | หน่วยอิสระใน simulation ที่รับรู้ world state ประเมินสถานะภายใน และตัดสินใจโดยไม่มีคำสั่งตรงจากภายนอก |
| Colonist | Agent มนุษย์ในสถานี มี needs, traits, relationships, memory และ goal stack |
| Module | หน่วยทางกายภาพของสถานี เช่น ห้อง โครงสร้าง หรืออุปกรณ์ ซึ่งมีความต้องการทรัพยากร ความจุ และสถานะการทำงาน |
| Need | มิติของความเป็นอยู่ของ colonist ที่เปลี่ยนตามเวลาและกระตุ้นการตัดสินใจเมื่อไม่ได้รับการตอบสนอง |
| Motivation | เหตุผลเบื้องหลัง goal ซึ่งเกิดจาก trait weights และสถานะ needs ปัจจุบัน |
| Trait | คุณลักษณะถาวรที่ปรับวิธีประเมิน needs ความสัมพันธ์ และการตัดสินใจ โดยไม่ใช่พฤติกรรมสำเร็จรูป |
| Goal | วัตถุประสงค์ที่ทำให้สำเร็จได้ มี priority, preconditions และ completion criteria |
| Task | หน่วยงานย่อยที่ผูกกับสถานที่หรือ Module และทำให้ goal คืบหน้าหรือสำเร็จ |
| Memory | บันทึกถาวรแบบมีขอบเขตของเหตุการณ์ ปฏิสัมพันธ์ และข้อสังเกตที่มีผลต่อการตัดสินใจภายหลัง |
| Relationship | มุมมองแบบมีทิศทางที่ colonist คนหนึ่งมีต่ออีกคนหนึ่ง โดยเกิดจากประวัติปฏิสัมพันธ์ |
| World State | snapshot ที่สมบูรณ์และ authoritative ของสถานะ simulation ณ tick หนึ่ง |
| Simulation Tick | หน่วยพื้นฐานของเวลาจำลองที่ใช้ประมวลผลทรัพยากร needs การตัดสินใจ เหตุการณ์ และสถานะใหม่ |
| Event | เหตุการณ์ที่มีเวลาแน่นอนและระบบอื่นอาจตอบสนองได้ |
| Crisis | สภาวะไม่มั่นคงที่เป็นอันตรายและดำเนินต่อเนื่องจนกว่าจะได้รับการแก้ไข ไม่ใช่ Event เดี่ยว |
| Resource | ปริมาณที่ผลิต ใช้ หรือจัดเก็บได้ เช่น oxygen, power, water, food และ spare parts |
| Colony | ระบบรวมของสถานี colonists วัฒนธรรม และความสัมพันธ์ |
| Station | โครงสร้างทางกายภาพของ Colony ซึ่งประกอบด้วย Modules ทางเดิน และโครงสร้างพื้นฐาน |
| Life Support | ระบบที่รักษาเงื่อนไขเพื่อการอยู่รอด เช่น oxygen, power, water, temperature และ food |
| Player | มนุษย์ที่กำหนดสภาพแวดล้อม นโยบาย และการตอบสนองต่อวิกฤต โดยไม่สั่ง colonist โดยตรง |
| AI Director | Agent ระดับอาณานิคมที่ติดตามสภาวะรวมและปรับการสร้าง Event เพื่อรักษาจังหวะของเรื่องราว โดยไม่ควบคุม colonist |

## คำศัพท์ของ workflow

| คำ | ความหมาย |
|---|---|
| Kanban Card | หน่วยงานที่กำหนดเป้าหมาย ขอบเขต acceptance criteria และสถานะงาน |
| Start Task | บันทึกขอบเขตและอำนาจที่ต้องจัดทำก่อนเริ่มแก้ไข |
| Decision Log | บันทึกการตัดสินใจ เหตุผล ทางเลือกที่พิจารณา และเงื่อนไขที่จะกลับมาทบทวน |
| Kanban Update | บันทึกสรุปงาน ไฟล์ที่เปลี่ยน validation และงานติดตามก่อนเปลี่ยนสถานะ |
| ADR | Architecture Decision Record ที่บันทึกบริบท การตัดสินใจ และผลกระทบของการเปลี่ยนสถาปัตยกรรม |
| Needs verification | สถานะของข้อมูลหรือผลตรวจที่ยังไม่ได้ยืนยันด้วยแหล่งข้อมูลหรือคำสั่งที่เหมาะสม |
| repository-relative path | path ที่เริ่มจากรากของ repository และไม่ผูกกับตำแหน่งแบบ absolute ของเครื่องใดเครื่องหนึ่ง |

ดูบริบทเพิ่มเติมที่ [[01-Project-Overview]], [[03-Architecture]] และ [[06-Development-Workflow]]
