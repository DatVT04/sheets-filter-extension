# ⚡ Sheets Filter Pro — Browser Extension

Extension Chrome/Edge để **lọc và highlight dữ liệu** trên Google Sheets theo nhiều điều kiện kết hợp.

---

## 📁 Cấu trúc file

```
sheets-filter-extension/
├── manifest.json     ← Khai báo extension
├── popup.html        ← Giao diện popup
├── popup.js          ← Logic UI & gửi lệnh
├── content.js        ← Chạy trong Sheets, đọc & highlight
├── content.css       ← Style inject
└── icons/            ← Icon extension
```

---

## 🚀 Cách cài đặt

1. **Mở Chrome/Edge** → truy cập `chrome://extensions/`
2. Bật **Developer mode** (góc trên phải)
3. Click **"Load unpacked"**
4. Chọn thư mục `sheets-filter-extension`
5. Extension xuất hiện trên toolbar ✅

---

## 🎯 Cách dùng

1. Mở file **Google Sheets** bất kỳ
2. Click icon extension trên toolbar
3. Chọn **màu highlight** mong muốn
4. Thêm **điều kiện lọc**:
   - Nhập **cột** (A, B, C...)
   - Chọn **toán tử** (chứa, bằng, >, <...)
   - Nhập **giá trị** cần lọc
5. Với nhiều điều kiện, click **AND/OR** để đổi logic
6. Click **▶ Áp dụng highlight**
7. Xem thống kê số dòng khớp bên dưới

---

## ⚠️ Lưu ý

- Extension đọc dữ liệu qua **DOM của Sheets** (accessible mode)
- Nếu Sheets dùng canvas rendering thuần túy, có thể cần **zoom out** trang để DOM accessible xuất hiện
- Highlight sẽ mất khi reload trang (chỉ là visual overlay)
- Không chỉnh sửa dữ liệu gốc trong Sheets

---

## 🔧 Các toán tử hỗ trợ

| Toán tử | Mô tả |
|---------|-------|
| chứa / không chứa | Tìm chuỗi con |
| = bằng / ≠ khác | So sánh chính xác |
| > / < / ≥ / ≤ | So sánh số |
| trống / không trống | Kiểm tra ô rỗng |
| bắt đầu / kết thúc bằng | Prefix/Suffix |
