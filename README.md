# petshop-pos

ระบบขายหน้าร้านเพ็ทช็อป ใช้ได้ทั้งคอมหน้าร้านและมือถือ ข้อมูลเก็บใน Firebase (Firestore) ใช้งานได้แม้เน็ตหลุด แล้วซิงก์เองเมื่อเน็ตกลับมา

## โครงสร้าง
- `index.html` หน้าเดียวของแอป
- `js/app.js` หน้าจอทั้งหมด (ขาย, ค้นหา, สินค้า, บิลวันนี้, ตั้งค่า)
- `js/db.js` การอ่าน/เขียนข้อมูล Firebase
- `js/config.js` ค่าโปรเจกต์ Firebase และอีเมลเจ้าของร้าน
- `firestore.rules` กฎความปลอดภัย (ต้องคัดลอกไปวางใน Firebase Console)
- `sw.js`, `manifest.webmanifest` ให้ติดตั้งเป็นแอปและเปิดได้ตอนออฟไลน์

## ข้อมูลใน Firestore
- `catalog/c00..c15` สินค้าแบ่งเป็น 16 ก้อน (โหลดทั้งร้านด้วย 16 reads)
- `sales/{billId}` บิลขาย (ตัดสต็อกในก้อนสินค้าพร้อมกัน)
- `priceLog` ประวัติการเปลี่ยนราคาขายและต้นทุน
- `meta/settings`, `meta/brands`, `meta/staff`, `meta/info`

ฟอนต์ Google Sans ใช้ภายใต้ SIL Open Font License (`fonts/OFL.txt`)
