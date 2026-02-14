# 06. Data Modeling - Semantic Layer

## 1. Muc tieu module
- Tao quan he giua cac bang de truy van dung nghia nghiep vu.
- Quan ly relationship type va cross-filter direction.
- Tang do chinh xac cho Ask AI va Dashboard Studio.

## 2. Cac che do xem
- `List View`: xem bang/column/suggestion dang danh sach.
- `Diagram View`: keo tha node bang, noi relation truc quan.
- `Active Relationships`: theo doi relation hop le/khong hop le.

## 3. Quy trinh thao tac de xuat
### 3.1 Kiem tra bang trong semantic model
1. Mo `Data Modeling`.
2. Chon `List View`.
3. Tim bang theo search.
4. Kiem tra cac cot khoa (key) duoc danh dau.

### 3.2 Tu dong de xuat quan he
1. Bam `Auto Detect Relationship`.
2. Xem danh sach de xuat + confidence.
3. `Accept` relation dung, `Reject` relation sai.
4. Co the dung bulk accept/reject.

### 3.3 Tao relation thu cong
1. Bam `Create Relationship`.
2. Chon `Table A/Column A` va `Table B/Column B`.
3. Chon `relationship type` (`1-1`, `1-n`, `n-1`, `n-n`).
4. Chon `cross filter direction` (`single`/`both`).
5. Luu relation.

### 3.4 Chinh sua relation tren Diagram
1. Chuyen `Diagram View`.
2. Keo tu handle column bang A sang column bang B de tao relation.
3. Right-click edge relation de mo menu.
4. Sua type/direction hoac delete relation.

### 3.5 Theo doi trang thai relation
1. Mo `Active Relationships`.
2. Xem so relation `Active`, `Invalid`, `Total`.
3. Chinh sua relation invalid den khi hop le.

## 4. Luu y quyen han
- Viewer: chi doc.
- Admin/Editor: tao/sua/xoa relation.

## 5. Loi thuong gap
- Relation invalid: kieu du lieu 2 cot khong tuong thich hoac cardinality sai.
- Auto detect it de xuat: schema dat ten cot khong nhat quan.
- Diagram khong cho noi edge: user khong co quyen sua.

## 6. Hinh minh hoa can co
![M05-01 Data Modeling Header](./images/M05-01-data-modeling-header.png)
- Callout: 3 view mode + refresh.

![M05-02 List View](./images/M05-02-data-modeling-list-view.png)
- Callout: table list, column list, create relation.

![M05-03 Suggestions](./images/M05-03-data-modeling-suggestions.png)
- Callout: confidence, accept/reject.

![M05-04 Diagram View](./images/M05-04-data-modeling-diagram.png)
- Callout: node bang, handle cot, edge relation.

![M05-05 Edge Context Menu](./images/M05-05-data-modeling-edge-menu.png)
- Callout: relationship type, cross filter, save/delete.

![M05-06 Active Relationships](./images/M05-06-data-modeling-active-view.png)
- Callout: valid/invalid counters, edit/delete inline.

