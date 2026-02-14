# 03. Connections - Ket Noi Nguon Du Lieu

## 1. Muc tieu module
- Tao va quan ly pipeline ket noi du lieu.
- Chon bang/sheet can dong bo vao he thong.

## 2. Nguon du lieu ho tro thao tac trong he thong hien tai
- BigQuery
- PostgreSQL
- Excel
- Google Sheets

## 3. Flow chung tao ket noi
1. Vao `Connections`.
2. Bam `New Pipeline`.
3. Chon loai ket noi + dat ten.
4. Xac thuc ket noi (OAuth/Service Account/Password/File).
5. Chon context (project/schema/file).
6. Chon table/sheet can dong bo.
7. Bam luu/deploy ket noi.

## 4. Huong dan theo tung loai ket noi
### 4.1 BigQuery (GoogleMail OAuth)
1. Chon `BigQuery` + auth type `GoogleMail`.
2. Bam dang nhap Google.
3. Chon Project.
4. Chon Dataset.
5. Chon table can sync.
6. Luu ket noi.

### 4.2 BigQuery (Service Account)
1. Chon `BigQuery` + auth type `ServiceAccount`.
2. Upload file JSON key hop le.
3. He thong doc `project_id` va `client_email`.
4. Chon dataset/table can sync.
5. Luu ket noi.

### 4.3 PostgreSQL
1. Nhap host, port, database, username, password, SSL.
2. Bam `Test Connection`.
3. Bam `Save & Continue`.
4. Chon schema va table/view.
5. Chon che do import:
   - `Full`: dong bo toan bo.
   - `Incremental`: chon cot increment + key upsert.
6. Chay import va cho den trang thai `completed`.

### 4.4 Excel
1. Chon `Excel`.
2. Upload file `.xlsx`/`.xls`.
3. Chon dataset dich.
4. Chon sheet can import.
5. Bam luu ket noi.

### 4.5 Google Sheets
1. Chon `GoogleSheets`.
2. OAuth Google.
3. Chon file tu danh sach hoac dan URL sheet.
4. Chon tab can import.
5. Chon `header mode` va sync mode (`manual`/`interval`).
6. Luu ket noi.

## 5. Quan ly ket noi da tao
- Edit ten/cau hinh ket noi.
- Re-sync du lieu ket noi.
- Xoa ket noi (he thong se bo cac table lien quan khoi registry).

## 6. Loi thuong gap
- OAuth popup bi chan: cho phep popup tren browser.
- JSON service account sai format: can co `project_id`, `client_email`, `private_key`.
- PostgreSQL test fail: kiem tra IP whitelist, port, SSL.
- Google Sheets URL sai: dung URL file goc cua Google Sheets.

## 7. Hinh minh hoa can co
![M02-01 Connections Dashboard](./images/M02-01-connections-list.png)
- Callout: nut `New Pipeline`, danh sach connection, trang thai.

![M02-02 Wizard Step 1](./images/M02-02-wizard-step1-type-name.png)
- Callout: chon warehouse type, dat ten ket noi.

![M02-03 BigQuery OAuth](./images/M02-03-bigquery-oauth.png)
- Callout: nut login Google, project selector.

![M02-04 Service Account Upload](./images/M02-04-bigquery-service-account.png)
- Callout: khu vuc upload JSON key.

![M02-05 PostgreSQL Config](./images/M02-05-postgres-config.png)
- Callout: host/port/db/user/pass/SSL + test button.

![M02-06 PostgreSQL Import](./images/M02-06-postgres-import-options.png)
- Callout: schema selector, table selector, full/incremental.

![M02-07 Excel Import](./images/M02-07-excel-import.png)
- Callout: file upload, sheet selection, dataset.

![M02-08 Google Sheets Import](./images/M02-08-google-sheets-import.png)
- Callout: file picker, tab picker, sync mode.

