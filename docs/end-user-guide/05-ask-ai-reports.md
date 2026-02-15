# 05. Ask AI - Bao Cao Tu Van Du Lieu

## 1. Muc tieu module
- Hoi dap du lieu theo ngon ngu tu nhien.
- Tu dong sinh KPI, chart, insight chien luoc.
- Cho phep debug SQL de tinh chinh ket qua.

## 2. Cac khu vuc chinh
- `Report Sidebar`: quan ly session phan tich.
- `Analysis`: khung chat hoi-dap voi AI.
- `Data Assets`: chon bang dua vao context phan tich.
- `Model Selector`: chon engine AI.

## 3. Quy trinh thao tac de xuat
### 3.1 Tao session phan tich moi
1. Bam `New AI Analysis`.
2. Dat ten session (hoac de auto title theo cau hoi dau).

### 3.2 Chon ngu canh du lieu
1. Chuyen tab `Data Assets`.
2. Chon table can AI duoc phep su dung.
3. Bam `Save Selection`.

### 3.3 Dat cau hoi
1. Quay lai tab `Analysis`.
2. Nhap prompt ro rang (metric + period + dimension).
3. Bam gui.

### 3.4 Xu ly khi AI dang chay
- Co the bam `Cancel AI Job` neu truy van dai.
- Cau hoi moi se vao `Queue`.

### 3.5 Chinh sua ket qua
- Chinh prompt user message -> `Save & Re-run`.
- Mo `KPI SQL` de sua SQL tong cho KPI.
- Mo `Chart SQL` tren tung bieu do de chay lai truy van.

### 3.6 Quan ly session
- Rename session.
- Delete session.
- Tao lai session moi khi can tach nghiep vu.

## 4. Best practice dat prompt
- Neu ro pham vi: "tren tap table da chon".
- Neu co thoi gian: ghi ro "theo thang/quy/nam".
- Neu can so sanh: ghi ro "so voi ky truoc".
- Neu muon drill theo chieu: ghi ro dimension (region, product, channel).

## 5. Loi thuong gap
- Khong gui duoc prompt: chua chon table context.
- Ket qua sai ngu canh: chon lai Data Assets va gui lai.
- Loi auth BigQuery: bam `Re-Link Account`.
- SQL fail khi debug: test query voi dieu kien nho hon truoc.

## 6. Hinh minh hoa can co
![M04-01 Reports Layout](./images/M04-01-reports-layout.png)
- Callout: session sidebar, analysis pane, model selector.

![M04-02 Data Assets Selection](./images/M04-02-reports-data-assets-tab.png)
- Callout: chon table context + nut save.

![M04-03 Ask Prompt](./images/M04-03-reports-ask-prompt.png)
- Callout: input box, send button, context counter.

![M04-04 AI Response KPI Chart](./images/M04-04-reports-ai-response.png)
- Callout: KPI cards, chart blocks, insight block.

![M04-05 KPI SQL Debug](./images/M04-05-kpi-sql-debug.png)
- Callout: textarea SQL + run update.

![M04-06 Chart SQL Debug](./images/M04-06-chart-sql-debug.png)
- Callout: SQL editor tren chart + execute.

![M04-07 Session Management](./images/M04-07-session-actions.png)
- Callout: rename, delete, tao session moi.

## 7. Global Assistant v1
Global Assistant la floating chat thuc thi action that tren toan he thong. Trong module Reports, ban co the dung ngay cac lenh:
- "Tao report session moi ten Revenue Deep Dive."
- "Hoi reports: tong quan doanh thu 6 thang gan nhat."
- "Chay lai chart SQL cho message `<messageId>` voi SQL moi ...".
- "Chuyen toi tab Data Modeling."

### 7.1 Quy tac confirm risky
- Action rui ro (xoa user, xoa connection, xoa table, doi role/disable user) se vao trang thai `waiting_confirm`.
- Can bam `Approve` hoac `Reject` de tiep tuc.

### 7.2 Undo
- Lenh `undo` se hoat dong cho cac action co ho tro.
- Khong undo hard-delete tai nguyen phia server.

### 7.3 Gioi han can user thao tac tay
- OAuth/Google linking.
- Upload file (Excel/Google Sheets import).
- Cac popup trinh duyet bi chan quyen.
