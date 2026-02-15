# 07. Dashboard Studio - BI Builder

## 1. Muc tieu module
- Tao dashboard tu du lieu da dong bo.
- Keo-tha field vao widget de ve chart/table/KPI.
- Thiet lap chia se, quyen truy cap va RLS.

## 2. Bo cuc man hinh
- Left Sidebar (`Workspace/Data/Fields`): quan ly folder, dashboard, data source.
- Main Canvas: vung layout widget.
- Right Data Sidebar: chon table, drag field.
- Right Visual Builder: cau hinh widget theo tab.
- Toolbar tren cung: zoom/grid/preview/export/share/reload.
- Page Tabs duoi canvas: quan ly page trong dashboard.

## 3. Quy trinh end-to-end tao dashboard moi
### 3.1 Tao folder/dashboard
1. O Left Sidebar tab `Workspace`, tao `Folder` neu can.
2. Bam tao `Dashboard` moi.
3. Dat ten dashboard (co the sua truc tiep tren toolbar).

### 3.2 Chon data source cho dashboard/page
1. Mo Right Data Sidebar.
2. Tick cac bang duoc dung cho dashboard.
3. Chon bang active de hien danh sach field drag-tha.

### 3.3 Tao widget
1. Mo Right Visual Builder tab `Visualizations`.
2. Chon loai widget:
   - Chart: bar/line/area/pie/scatter...
   - Card, Table, Pivot
   - Slicer, Date Range, Search
   - Gauge
3. Widget duoc them vao canvas.

### 3.4 Cau hinh widget (Visual Builder)
- Tab `Data`:
  - Gan data source cho widget.
  - Keo-tha field vao xAxis/yAxis/legend/values/columns...
  - Chon aggregation (`sum`, `avg`, `count`, ...).
- Tab `Format`:
  - Tieu de, mau sac, label, legend, font, format so.
- Tab `Calculations`:
  - Tao calculated field/quick measure.
  - Cau hinh conditional formatting (co the dung AI goi y formula).

### 3.5 Sap xep bo cuc canvas
- Drag/resize widget tren grid.
- Multi-select widget (Ctrl/Cmd/Shift click).
- Dung floating toolbar de align/group/ungroup/delete.

### 3.6 Quan ly page
1. Them page moi (nut `+` o Page Tabs).
2. Rename page (double click hoac context menu).
3. Duplicate page khi muon tao bien the nhanh.
4. Xoa page (giu lai toi thieu 1 page).

### 3.7 Filter va cross-filter
- Global Filter Bar: filter toan dashboard.
- Widget filter (slicer/date range/search): ap filter lien widget/page.
- Click diem du lieu tren chart de tao cross-filter den widget khac cung page.

### 3.8 Share va RLS
1. Bam `Share` tren toolbar hoac tu dashboard/folder menu.
2. Chon user email.
3. Dat role (`viewer`, `edit`, `admin`) theo dashboard/folder.
4. Cau hinh RLS:
   - Allowed pages.
   - Rule theo field/operator/value.
5. Confirm dashboard config truoc khi save.

### 3.9 Export va van hanh
- Export dashboard: PDF/PNG (va JSON neu duoc mo trong flow export).
- Reload data thu cong: bam reload.
- Neu dang sync nhieu, co the stop all jobs.
- Neu BigQuery token het han: `Re-Link Account`.

## 4. Checklist truoc khi ban giao dashboard cho end-user
- [ ] Ten dashboard va page da ro nghia nghiep vu.
- [ ] Tat ca widget da gan dung data source.
- [ ] Filter/cross-filter da test tren data thuc.
- [ ] Khong con relation invalid trong Data Modeling.
- [ ] Quyen share va RLS da verify bang tai khoan thu.
- [ ] Export PDF/PNG khong vo layout.

## 5. Loi thuong gap
- Widget rong du lieu: chua map field dung hoac data source chua sync xong.
- Drag field khong vao slot: loai field khong tuong thich slot.
- Share khong save duoc: RLS chua confirm/thieu allowed pages.
- Viewer thay sai du lieu: rule RLS sai field hoac operator.

## 5.1 Tai lieu nang cao cho measure/calculated field
- Tham khao: [Huong Dan Measure & Calculated Fields](../USER_GUIDE_MEASURES.md)

## 6. Hinh minh hoa can co
![M06-01 Dashboard Studio Layout](./images/M06-01-dashboard-studio-layout.png)
- Callout: 4 panel chinh + toolbar + page tabs.

![M06-02 Workspace Sidebar](./images/M06-02-workspace-sidebar.png)
- Callout: tao folder/dashboard, rename, duplicate, share, delete.

![M06-03 Data Sidebar](./images/M06-03-right-data-sidebar.png)
- Callout: tick table, chon active table, danh sach field drag.

![M06-04 Add Widget](./images/M06-04-add-widget.png)
- Callout: menu loai widget.

![M06-05 Bind Data Slots](./images/M06-05-bind-fields-to-slots.png)
- Callout: xAxis/yAxis/legend/values.

![M06-06 Widget Formatting](./images/M06-06-widget-formatting.png)
- Callout: mau sac, legend, labels, number format.

![M06-07 Canvas Interaction](./images/M06-07-canvas-multi-select.png)
- Callout: multi-select toolbar (align/group/delete).

![M06-08 Page Tabs](./images/M06-08-page-tabs.png)
- Callout: add/rename/duplicate/delete page.

![M06-09 Global Filters](./images/M06-09-global-filter-bar.png)
- Callout: bo loc toan dashboard.

![M06-10 Share Modal](./images/M06-10-share-modal-manage.png)
- Callout: role theo resource + user email.

![M06-11 RLS Config](./images/M06-11-rls-config-panel.png)
- Callout: allowed pages, rules, confirm dashboard.

![M06-12 Export Toolbar](./images/M06-12-export-and-preview-toolbar.png)
- Callout: preview mode, zoom, grid, export.

## 7. Global Assistant trong Dashboard Studio
Ban co the ra lenh truc tiep thay vi thao tac tay tung buoc:
- "Tao dashboard moi ten Sales Executive."
- "Tao calculated field margin = (revenue-cost)/revenue."
- "Tao chart doanh thu theo thang."
- "Cap nhat widget `<widgetId>` doi tieu de thanh Revenue by Month."
- "Xoa widget `<widgetId>`." (yeu cau confirm vi la risky action)

### 7.1 Hanh vi chart mac dinh
- Neu dang o `/bi` va co active dashboard: tao chart ngay.
- Neu khong o `/bi`: assistant hoi 1 cau ngan de chon dashboard.
- Neu chua co dashboard nao: assistant hoi tao dashboard moi truoc.

### 7.2 Undo ho tro
- Ho tro undo cho:
  - create/update/delete widget
  - create/edit/delete calculated field
  - table status toggle
- Khong ho tro undo cho hard-delete resource phia server.

### 7.3 Action can input thu cong
- OAuth flow.
- Upload file import.
- Cac buoc can user click tren popup/browser permission.
