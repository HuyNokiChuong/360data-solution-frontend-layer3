# Hướng Dẫn Viết Measure & Calculated Fields

Tài liệu này hướng dẫn cách viết công thức cho **Calculated Fields** (Cột tính toán) và **Measures** (Chỉ số đo lường) trong hệ thống BI Dashboard.

## 1. Quy tắc Quan Trọng Nhất: Định danh Cột

Để đảm bảo tính chính xác của dữ liệu, đặc biệt khi làm việc với nhiều bảng (Data Sources) khác nhau, hệ thống yêu cầu **luôn luôn sử dụng tên bảng kèm theo tên cột**.

### Cú pháp Bắt buộc
```sql
[TênBảng.TênCột]
```

### Tại sao?
- **Tránh nhầm lẫn**: Nếu hai bảng có cùng tên cột (ví dụ: `[CreatedDate]`), hệ thống sẽ không biết bạn đang muốn dùng cột của bảng nào.
- **Đảm bảo tính nhất quán**: Khi join nhiều bảng hoặc sử dụng trong Pivot Table, việc chỉ định rõ nguồn gốc dữ liệu là bắt buộc.

### Ví dụ
❌ **Sai**:
```sql
[Revenue] - [Cost]
```

✅ **Đúng**:
```sql
[Sales_Data.Revenue] - [Sales_Data.Cost]
```

---

## 2. Các Hàm Hỗ Trợ

Hệ thống hỗ trợ các hàm tính toán cơ bản tương tự như Excel hoặc SQL.

### Toán tử Cơ bản
- Cộng: `+`
- Trừ: `-`
- Nhân: `*`
- Chia: `/` (Lưu ý: Hệ thống tự động xử lý lỗi chia cho 0 nếu dùng Measure)
- Ngoặc đơn: `()` để nhóm các phép tính

### Hàm Logic
- `IF(condition, true_value, false_value)`: Nếu điều kiện đúng trả về giá trị True, ngược lại trả về False.
- `AND(cond1, cond2)`: Trả về True nếu cả 2 điều kiện đều đúng.
- `OR(cond1, cond2)`: Trả về True nếu 1 trong 2 điều kiện đúng.
- `NOT(cond)`: Đảo ngược giá trị logic.

### Hàm Toán học
- `ABS(number)`: Giá trị tuyệt đối.
- `ROUND(number, digits)`: Làm tròn số.
- `CEILING(number)`: Làm tròn lên.
- `FLOOR(number)`: Làm tròn xuống.
- `MAX(num1, num2)`: Lấy số lớn nhất.
- `MIN(num1, num2)`: Lấy số nhỏ nhất.

### Hàm Chuỗi
- `CONCAT(str1, str2, ...)`: Nối chuỗi.
- `UPPER(str)`: Chuyển thành chữ hoa.
- `LOWER(str)`: Chuyển thành chữ thường.
- `LEN(str)`: Lấy độ dài chuỗi.

---

## 3. Ví dụ Thực tế

### Tính Lợi Nhuận (Profit)
```sql
[Orders.Revenue] - [Orders.Cost]
```

### Tính Tỷ suất Lợi nhuận (Profit Margin)
```sql
IF([Orders.Revenue] > 0, ([Orders.Revenue] - [Orders.Cost]) / [Orders.Revenue], 0)
```

### Phân loại Đơn hàng (Order Classification)
```sql
IF([Orders.TotalAmount] > 1000, "High Value", "Standard")
```

### Tính Thuế VAT (10%)
```sql
[Orders.Subtotal] * 0.1
```

---

## 4. Lưu ý về Pivot Table & Conditional Formatting

Khi sử dụng Calculated Field trong Pivot Table, bạn có thể áp dụng **Conditional Formatting** (Định dạng có điều kiện) để làm nổi bật dữ liệu:

1. Chọn **Pivot Table**.
2. Trong tab **Visualizations**, phần **Values**, nhấn vào nút **Rules** (biểu tượng cây cọ).
3. Thêm quy tắc:
   - **Condition**: Lớn hơn, Nhỏ hơn, Bằng, Nằm trong khoảng.
   - **Value**: Giá trị ngưỡng so sánh.
   - **Format**: Chọn màu chữ hoặc màu nền.

Hệ thống sẽ tự động áp dụng định dạng này cho cả các ô dữ liệu chi tiết và các ô Tổng (Total/Subtotal) nếu thỏa mãn điều kiện.
