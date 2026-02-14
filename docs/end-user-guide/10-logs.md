# 10. Logs - Audit Trail

## 1. Muc tieu module
- Theo doi lich su hanh dong he thong theo thoi gian gan real-time.
- Ho tro truy vet su co va audit van hanh.

## 2. Chuc nang chinh
- Tu dong refresh log dinh ky.
- Filter theo loai (`all/info/success/error`).
- Tim kiem theo action/entity/user.
- Xem chi tiet payload trong `details`.
- `Clear Local Cache` de reset view local.

## 3. Quy trinh thao tac
1. Vao `Logs`.
2. Chon filter type mong muon.
3. Nhap tu khoa tim kiem (entity, user, action).
4. Mo dong log can kiem tra, doc `action`, `entity`, `created_at`, `details`.

## 4. Cach doc nhanh log
- `success`: thao tac thanh cong.
- `error`: thao tac that bai, can xem `details`.
- `info`: thong tin he thong/trang thai.

## 5. Hinh minh hoa can co
![M09-01 Logs Overview](./images/M09-01-logs-overview.png)
- Callout: search, filter, refresh timestamp.

![M09-02 Log Row Detail](./images/M09-02-log-row-detail.png)
- Callout: action, entity, user, details JSON.

