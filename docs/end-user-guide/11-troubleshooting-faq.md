# 11. Troubleshooting & FAQ

## 1. Bang xu ly su co nhanh
| Hien tuong | Nguyen nhan pho bien | Cach xu ly |
|---|---|---|
| Khong dang nhap duoc | Sai email corporate hoac mat khau | Kiem tra domain email, reset mat khau, thu lai |
| OTP khong hop le | Ma cu/het han | Bam resend, dung ma moi nhat |
| Module bi khoa | Chua co connection | Tao connection trong `Connections` |
| Ask AI khong tra ve du lieu | Chua chon Data Assets hoac table pause | Chon lai context table va bat `Active` |
| Loi auth BigQuery | Token het han | Bam `Re-Link Account` |
| Chart trong Dashboard rong | Map field sai hoac source chua sync | Kiem tra slot field + reload data source |
| Share save bi disable | RLS chua confirm/thieu page | Bo sung allowed pages + confirm RLS |
| Viewer thay sai du lieu | Rule RLS sai | Ra soat field/operator/value trong RLS panel |
| Khong thay model AI mong muon | Chua cau hinh key provider | Cap nhat API key o `AI Settings` |

## 2. FAQ
### Q1: Co the dung nhieu table cho 1 dashboard/page khong?
Co. Tick nhieu table trong Right Data Sidebar, sau do chon table active de drag field.

### Q2: Co the sua SQL do AI sinh ra khong?
Co. Trong Ask AI, mo `KPI SQL` hoac `Chart SQL` de sua va chay lai.

### Q3: Viewer co sua dashboard duoc khong?
Khong. Viewer chu yeu chi xem theo quyen duoc share.

### Q4: Data Modeling co bat buoc khong?
Khong bat buoc 100%, nhung rat khuyen nghi neu co nhieu bang va can join dung nghiep vu.

### Q5: Export duoc dinh dang nao?
He thong ho tro xuat PDF/PNG tren toolbar dashboard (va JSON trong flow export neu duoc mo).

## 3. Runbook support de xuat
1. Thu thap screenshot loi + timestamp.
2. Kiem tra `Logs` theo user va hanh dong.
3. Xac dinh la loi auth, schema hay quyen.
4. Khac phuc va test lai tren tai khoan user bi anh huong.
