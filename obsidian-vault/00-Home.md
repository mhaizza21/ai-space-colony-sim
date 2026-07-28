---
title: "ฐานความรู้ AI Space Colony Sim"
type: "home"
status: "active"
source_paths:
  - "ai-studio/AI_STUDIO_BOOT.md"
  - "ai-studio/SYSTEM_MAP.md"
  - "docs/README.md"
last_verified: "2026-07-29"
---

# ฐานความรู้ AI Space Colony Sim

Vault นี้สรุปข้อมูลที่ตรวจสอบย้อนกลับได้จากเอกสารใน repository เพื่อช่วยนำทางโครงการโดยไม่แทนที่แหล่งข้อมูลต้นฉบับ ลำดับเริ่มต้นที่แนะนำคือ [[01-Project-Overview]] → [[02-Current-Status]] → [[03-Architecture]] → [[06-Development-Workflow]]

## ดัชนีหลัก

- [[01-Project-Overview]] — วิสัยทัศน์ เสาหลัก กลุ่มผู้เล่น และโครงสร้าง repository
- [[02-Current-Status]] — branch ปัจจุบัน snapshot และรายการที่ยังเป็น Needs verification
- [[03-Architecture]] — ลำดับอำนาจ ขอบเขต และหลักประกันทางสถาปัตยกรรม
- [[04-Game-Design]] — เสาหลัก วงจรการเล่น และระบบการออกแบบ
- [[05-Systems-and-Modules]] — runtime โมดูล บริการ และคำสั่ง CLI
- [[06-Development-Workflow]] — ขั้นตอนเริ่มงาน Kanban และลำดับการตรวจทาน
- [[07-Decisions-and-ADRs]] — ดัชนี ADR และสถานะการตัดสินใจ
- [[08-Risks-and-Technical-Debt]] — ความเสี่ยง หนี้ทางเทคนิค และแนวทางควบคุม
- [[09-Open-Questions]] — คำถามที่ยังไม่มีหลักฐานยืนยัน
- [[10-Task-Board]] — สถานะงานและขอบเขตงาน Vault รอบปัจจุบัน
- [[Glossary]] — คำศัพท์มาตรฐานของโครงการ
- [[Maps/architecture-system-context]] — แผนภาพบริบทสถาปัตยกรรม
- [[Maps/directory-authority-map]] — แผนภาพอำนาจของไดเรกทอรี
- [[Maps/dependency-matrix]] — ตารางความสัมพันธ์ระหว่างเอกสารกับส่วนระบบ

## หลักการใช้งาน

- ใช้ `source_paths` แบบ repository-relative เท่านั้น
- ข้อมูลที่ยังตรวจสอบไม่ได้ต้องระบุ `Needs verification` หรือใช้ `status: "unknown"` และ `last_verified: null` ตามบริบท
- Existing Kanban card confirmed by project owner; online metadata not locally verified.
